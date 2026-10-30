import { CheckIn, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { FEE_REMINDER_DAY, FEE_RESTRICTION_DAY } from '../config/constants';
import { recordAuditEvent } from './auditService';
import { formatKes } from './smsTemplates';

/**
 * Unpaid ACISI check-in fees (C20). Nobody waits on M-Pesa to be seen: a
 * remote check-in joins the queue straight away (CheckIn.queuedBeforePaymentAt)
 * and the fee is confirmed in the background. If the payment then fails
 * (FAILED) or M-Pesa never answers (NEEDS_REVIEW), the fee is OWED:
 *
 * - the patient's profile shows it with a Pay button (from FEE_REMINDER_DAY
 *   as a reminder);
 * - their next remote check-in asks for the old fee plus the new one in one
 *   M-Pesa prompt, then goes ahead as normal;
 * - from FEE_RESTRICTION_DAY, if FEE_RESTRICTION_ENABLED, remote check-in and
 *   booking are blocked until it's paid. Login, records, PIN reset, the
 *   sharing switch and account deletion always keep working, and walk-ins
 *   are never affected (the clinic never collects ACISI's fee).
 *
 * A fee stops being owed when M-Pesa or front desk confirms it after all
 * (status PAID), or when a later payment covers it (feeSettledAt).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Check-ins whose fee is owed: queued before payment, payment failed or unanswered, not paid off since. */
export function owedFeesWhere(patientId: string): Prisma.CheckInWhereInput {
  return { patientId, queuedBeforePaymentAt: { not: null }, status: { in: ['FAILED', 'NEEDS_REVIEW'] }, feeSettledAt: null };
}

/** The part of a check-in's amount that was its own fee (not earlier fees it was also collecting). */
export function ownFeeKes(checkIn: Pick<CheckIn, 'amountKes' | 'includesOutstandingKes'>): number {
  return Number(checkIn.amountKes) - checkIn.includesOutstandingKes;
}

export interface OutstandingFees {
  checkIns: CheckIn[];
  totalKes: number;
  oldestAt: Date | null;
}

export async function getOutstandingFees(patientId: string, db: Db = prisma): Promise<OutstandingFees> {
  const checkIns = await db.checkIn.findMany({ where: owedFeesWhere(patientId), orderBy: { createdAt: 'asc' } });
  return {
    checkIns,
    totalKes: checkIns.reduce((sum, c) => sum + ownFeeKes(c), 0),
    oldestAt: checkIns[0]?.createdAt ?? null,
  };
}

export interface FeeStatus {
  owedKes: number;
  oldestOwedAt: Date | null;
  daysOwed: number;
  /** FEE_REMINDER_DAY reached: show the reminder notice. */
  reminder: boolean;
  restricted: boolean;
  /** The message shown when restricted. */
  restrictionMessage: string | null;
}

export function restrictionMessage(owedKes: number): string {
  return `Your account is restricted until your unpaid check-in fee of KSh ${formatKes(owedKes)} is paid.`;
}

export async function getFeeStatus(patientId: string, now: Date = new Date()): Promise<FeeStatus> {
  const [owed, patient] = await Promise.all([
    getOutstandingFees(patientId),
    prisma.patient.findUnique({ where: { id: patientId }, select: { feeRestrictedAt: true } }),
  ]);
  const daysOwed = owed.oldestAt ? Math.floor((now.getTime() - owed.oldestAt.getTime()) / DAY_MS) : 0;
  const restricted = env.FEE_RESTRICTION_ENABLED && !!patient?.feeRestrictedAt && owed.totalKes > 0;
  return {
    owedKes: owed.totalKes,
    oldestOwedAt: owed.oldestAt,
    daysOwed,
    reminder: owed.totalKes > 0 && daysOwed >= FEE_REMINDER_DAY,
    restricted,
    restrictionMessage: restricted ? restrictionMessage(owed.totalKes) : null,
  };
}

export class FeeRestrictedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeRestrictedError';
  }
}

/** Remote check-in and booking only: throws while the account is restricted. */
export async function assertNotFeeRestricted(patientId: string): Promise<void> {
  const status = await getFeeStatus(patientId);
  if (status.restricted) throw new FeeRestrictedError(status.restrictionMessage!);
}

/**
 * Called in the same transaction as a fee payment that just succeeded:
 * marks the earlier owed fees it was collecting (includesOutstandingKes) as
 * settled, oldest first.
 */
export async function settleOutstandingFees(tx: Prisma.TransactionClient, paying: CheckIn): Promise<string[]> {
  if (paying.includesOutstandingKes <= 0) return [];
  const owed = await tx.checkIn.findMany({
    where: { ...owedFeesWhere(paying.patientId), id: { not: paying.id } },
    orderBy: { createdAt: 'asc' },
  });
  let remaining = paying.includesOutstandingKes;
  const settled: string[] = [];
  const now = new Date();
  for (const c of owed) {
    const fee = ownFeeKes(c);
    if (fee > remaining) break;
    await tx.checkIn.update({ where: { id: c.id }, data: { feeSettledAt: now, feeSettledByCheckInId: paying.id } });
    remaining -= fee;
    settled.push(c.id);
  }
  return settled;
}

/** Lifts a restriction the moment nothing is owed any more (and audit-logs it). */
export async function liftRestrictionIfClear(patientId: string): Promise<boolean> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { feeRestrictedAt: true } });
  if (!patient?.feeRestrictedAt) return false;
  if ((await getOutstandingFees(patientId)).totalKes > 0) return false;
  const { count } = await prisma.patient.updateMany({ where: { id: patientId, feeRestrictedAt: { not: null } }, data: { feeRestrictedAt: null } });
  if (count === 0) return false;
  await recordAuditEvent({ actorType: 'SYSTEM', action: 'FEE_RESTRICTION_LIFTED', entityType: 'Patient', entityId: patientId });
  return true;
}

/**
 * Hourly: restricts accounts with a fee owed for FEE_RESTRICTION_DAY days or
 * more (only if FEE_RESTRICTION_ENABLED), and lifts any restriction whose
 * fees are no longer owed. Each change is audit-logged.
 */
export async function applyFeeRestrictions(now: Date = new Date()): Promise<{ restricted: number; lifted: number }> {
  let restricted = 0;
  let lifted = 0;

  if (env.FEE_RESTRICTION_ENABLED) {
    const cutoff = new Date(now.getTime() - FEE_RESTRICTION_DAY * DAY_MS);
    const overdue = await prisma.checkIn.findMany({
      where: {
        queuedBeforePaymentAt: { not: null },
        status: { in: ['FAILED', 'NEEDS_REVIEW'] },
        feeSettledAt: null,
        createdAt: { lte: cutoff },
        patient: { feeRestrictedAt: null, deletedAt: null },
      },
      select: { patientId: true, id: true },
      distinct: ['patientId'],
    });
    for (const { patientId, id } of overdue) {
      const { count } = await prisma.patient.updateMany({ where: { id: patientId, feeRestrictedAt: null }, data: { feeRestrictedAt: now } });
      if (count === 0) continue;
      restricted += 1;
      await recordAuditEvent({
        actorType: 'SYSTEM',
        action: 'FEE_RESTRICTION_APPLIED',
        entityType: 'Patient',
        entityId: patientId,
        metadata: { oldestOwedCheckInId: id, afterDays: FEE_RESTRICTION_DAY },
      });
    }
  }

  const stillRestricted = await prisma.patient.findMany({ where: { feeRestrictedAt: { not: null } }, select: { id: true } });
  for (const { id } of stillRestricted) {
    if (await liftRestrictionIfClear(id)) lifted += 1;
  }
  return { restricted, lifted };
}

/** Owner page: every patient with an owed fee, ACISI ID and amounts only. */
export async function listPendingFees() {
  const owed = await prisma.checkIn.findMany({
    where: { queuedBeforePaymentAt: { not: null }, status: { in: ['FAILED', 'NEEDS_REVIEW'] }, feeSettledAt: null },
    select: { patientId: true, amountKes: true, includesOutstandingKes: true, createdAt: true, patient: { select: { patientCode: true, feeRestrictedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const byPatient = new Map<string, { patientCode: string; owedKes: number; oldestAt: Date; restricted: boolean; count: number }>();
  for (const c of owed) {
    const row = byPatient.get(c.patientId) ?? {
      patientCode: c.patient.patientCode,
      owedKes: 0,
      oldestAt: c.createdAt,
      restricted: !!c.patient.feeRestrictedAt,
      count: 0,
    };
    row.owedKes += ownFeeKes(c);
    row.count += 1;
    byPatient.set(c.patientId, row);
  }
  const rows = [...byPatient.values()];
  return {
    rows,
    totalKes: rows.reduce((s, r) => s + r.owedKes, 0),
    restrictedCount: rows.filter((r) => r.restricted).length,
    restrictionEnabled: env.FEE_RESTRICTION_ENABLED,
  };
}
