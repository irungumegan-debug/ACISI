import { EncounterStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { sendPatientSms } from './smsService';
import { buildNearlyNextSms } from './smsTemplates';
import { recordAuditEvent } from './auditService';
import { logger } from '../utils/logger';

/**
 * Where a patient stands in today's queue, however they checked in (walk-in
 * at the front desk, remote from the portal, or USSD), and the "you're
 * nearly next" SMS.
 */

interface QueueEncounter {
  id: string;
  clinicId: string;
  status: EncounterStatus | string;
  assignedDoctorId: string | null;
  createdAt: Date;
}

/**
 * Place in the queue (1 = next): WAITING visits at the same clinic and
 * department that started earlier and could go to the same doctor, plus
 * this one. Null once the patient is no longer waiting.
 */
export async function queuePositionFor(encounter: QueueEncounter, departmentId: string): Promise<number | null> {
  if (encounter.status !== 'WAITING') return null;
  const ahead = await prisma.encounter.count({
    where: {
      clinicId: encounter.clinicId,
      status: 'WAITING',
      createdAt: { lt: encounter.createdAt },
      checkIn: { departmentId },
      ...(encounter.assignedDoctorId ? { OR: [{ assignedDoctorId: encounter.assignedDoctorId }, { assignedDoctorId: null }] } : {}),
    },
  });
  return ahead + 1;
}

/** Visits still in progress are shown for up to a day after check-in. */
const VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE: EncounterStatus[] = ['WAITING', 'IN_CONSULTATION', 'AWAITING_LAB', 'READY_FOR_CHECKOUT'];

export type VisitStage = 'WAITING' | 'BACK_FROM_LAB' | 'WITH_DOCTOR' | 'AT_LAB' | 'READY_FOR_CHECKOUT';

export interface VisitToday {
  encounterId: string;
  clinicName: string;
  departmentName: string;
  checkedInAt: Date;
  stage: VisitStage;
  /** 1 = next; only while waiting. */
  queuePosition: number | null;
  /** True while the check-in fee is still being confirmed (pay later). */
  feePending: boolean;
}

/** The patient's own visits still in progress (any check-in channel), oldest first. */
export async function getVisitsToday(patientId: string, now: Date = new Date()): Promise<VisitToday[]> {
  const encounters = await prisma.encounter.findMany({
    where: { patientId, status: { in: ACTIVE }, createdAt: { gte: new Date(now.getTime() - VISIT_WINDOW_MS) } },
    orderBy: { createdAt: 'asc' },
    include: {
      clinic: { select: { name: true } },
      checkIn: { select: { departmentId: true, status: true, feeSettledAt: true, department: { select: { name: true } } } },
      labOrders: { where: { status: 'RESULTS_READY' }, select: { id: true }, take: 1 },
    },
  });
  return Promise.all(
    encounters.map(async (e) => {
      const stage: VisitStage =
        e.status === 'WAITING'
          ? e.labOrders.length > 0
            ? 'BACK_FROM_LAB'
            : 'WAITING'
          : e.status === 'IN_CONSULTATION'
            ? 'WITH_DOCTOR'
            : e.status === 'AWAITING_LAB'
              ? 'AT_LAB'
              : 'READY_FOR_CHECKOUT';
      return {
        encounterId: e.id,
        clinicName: e.clinic.name,
        departmentName: e.checkIn.department.name,
        checkedInAt: e.createdAt,
        stage,
        queuePosition: await queuePositionFor(e, e.checkIn.departmentId),
        feePending: e.checkIn.status !== 'PAID' && e.checkIn.status !== 'NO_FEE' && !e.checkIn.feeSettledAt,
      };
    }),
  );
}

/** Send "nearly next" when this many or fewer people are ahead (position <= this + 1). */
export const NEARLY_NEXT_PEOPLE_AHEAD = 2;
/** ...and only to someone who has waited at least this long (no SMS for walking into an empty clinic). */
export const NEARLY_NEXT_MIN_WAIT_MS = 10 * 60 * 1000;

/**
 * Once a minute (jobs/queueAlertWorker): every waiting patient with 2 or
 * fewer people ahead, waiting 10+ minutes, gets one SMS for this visit.
 * Respects "does not want SMS"; counted against the clinic's allowance.
 * Returns how many were sent.
 */
export async function sendNearlyNextSms(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const candidates = await prisma.encounter.findMany({
    where: {
      status: 'WAITING',
      nearlyNextSmsAt: null,
      createdAt: { gte: new Date(now.getTime() - VISIT_WINDOW_MS), lte: new Date(now.getTime() - NEARLY_NEXT_MIN_WAIT_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: {
      clinic: { select: { name: true } },
      checkIn: { select: { departmentId: true } },
      patient: { select: { phoneNumber: true, smsOptOut: true, deletedAt: true } },
    },
  });
  let sent = 0;
  let skipped = 0;
  for (const e of candidates) {
    const position = await queuePositionFor(e, e.checkIn.departmentId);
    if (position === null || position > NEARLY_NEXT_PEOPLE_AHEAD + 1) continue;
    // Claim it first, so two sweeps can never both send.
    const claimed = await prisma.encounter.updateMany({ where: { id: e.id, nearlyNextSmsAt: null, status: 'WAITING' }, data: { nearlyNextSmsAt: now } });
    if (claimed.count === 0) continue;
    try {
      const outcome = await sendPatientSms(e.patient, buildNearlyNextSms({ clinicName: e.clinic.name, peopleAhead: position - 1 }), {
        purpose: 'QUEUE_NEARLY_NEXT',
        clinicId: e.clinicId,
      });
      if (outcome === 'sent') sent++;
      else skipped++;
      await recordAuditEvent({
        actorType: 'SYSTEM',
        clinicId: e.clinicId,
        action: 'QUEUE_NEARLY_NEXT_SMS',
        entityType: 'Encounter',
        entityId: e.id,
        metadata: { outcome, peopleAhead: position - 1 },
      });
    } catch (err) {
      logger.error({ err, encounterId: e.id }, 'Nearly-next SMS failed');
    }
  }
  return { sent, skipped };
}
