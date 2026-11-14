import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { sendSms } from './smsService';
import { buildNotifiableAlertSms } from './smsTemplates';
import { ageInYears } from './labService';
import { logger } from '../utils/logger';
import { matchNotifiable, NOTIFIABLE_DISEASES, NOTIFIABLE_LIST_CONFIRMED, NotifiableReporting } from './notifiableDiseases';

/**
 * Notifiable (IDSR) diseases: when a doctor signs a visit with an ICD-11
 * code on the list (notifiableDiseases.ts), a case is recorded, the doctor
 * is told on screen, and for immediately reportable diseases the clinic's
 * admins and doctors get an SMS (no patient and no disease in it: phones are
 * read by others). Doctors see and mark cases as reported; doctors and
 * admins see the weekly counts (no names).
 */

export interface NotifiableAlert {
  diseaseId: string;
  name: string;
  reporting: NotifiableReporting;
  icd11Code: string;
}

type Tx = Prisma.TransactionClient;

/** Called inside the signing transaction. Returns what the doctor is told. */
export async function recordNotifiableCases(
  tx: Tx,
  input: { encounterId: string; patientId: string; clinicId: string; staffId: string; codes: string[]; diagnosedAt: Date },
): Promise<NotifiableAlert[]> {
  const matches = matchNotifiable(input.codes);
  if (matches.length === 0) return [];
  await tx.notifiableDiseaseCase.createMany({
    data: matches.map(({ disease, code }) => ({
      clinicId: input.clinicId,
      encounterId: input.encounterId,
      patientId: input.patientId,
      diseaseId: disease.id,
      diseaseName: disease.name,
      reporting: disease.reporting,
      icd11Code: code,
      diagnosedAt: input.diagnosedAt,
      diagnosedByStaffId: input.staffId,
    })),
    skipDuplicates: true,
  });
  return matches.map(({ disease, code }) => ({ diseaseId: disease.id, name: disease.name, reporting: disease.reporting, icd11Code: code }));
}

/**
 * After signing: audit, and SMS the clinic's admins and doctors when a
 * disease must be reported within 24 hours. Never throws (signing is done).
 */
export async function notifyNotifiableCases(input: { clinicId: string; staffId: string; encounterId: string; alerts: NotifiableAlert[] }): Promise<void> {
  if (input.alerts.length === 0) return;
  try {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'NOTIFIABLE_DISEASE_DIAGNOSED',
      entityType: 'Encounter',
      entityId: input.encounterId,
      metadata: { diseaseIds: input.alerts.map((a) => a.diseaseId), immediate: input.alerts.some((a) => a.reporting === 'IMMEDIATE') },
    });
    if (!input.alerts.some((a) => a.reporting === 'IMMEDIATE')) return;

    const [clinic, staff] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true } }),
      prisma.staff.findMany({
        where: { clinicId: input.clinicId, isActive: true, role: { in: ['ADMIN', 'DOCTOR'] } },
        select: { phoneNumber: true },
      }),
    ]);
    const message = buildNotifiableAlertSms({ clinicName: clinic?.name ?? 'your clinic' });
    let sent = 0;
    for (const s of staff) if ((await sendSms(s.phoneNumber, message, 'NOTIFIABLE_DISEASE_ALERT')) === 'sent') sent++;
    await recordAuditEvent({
      actorType: 'SYSTEM',
      clinicId: input.clinicId,
      action: 'NOTIFIABLE_DISEASE_ALERT_SENT',
      entityType: 'Encounter',
      entityId: input.encounterId,
      metadata: { recipients: staff.length, sent },
    });
  } catch (err) {
    logger.error({ err, encounterId: input.encounterId }, 'Notifiable disease alert failed');
  }
}

export interface NotifiableCaseView {
  id: string;
  diseaseName: string;
  reporting: NotifiableReporting;
  icd11Code: string;
  diagnosedAt: Date;
  diagnosedBy: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: string;
  reportedAt: Date | null;
  reportedBy: string | null;
  reportNote: string | null;
}

/** The clinic's cases, newest first: doctors only (names a patient and a diagnosis). */
export async function listNotifiableCases(clinicId: string, options: { unreportedOnly?: boolean } = {}): Promise<NotifiableCaseView[]> {
  const rows = await prisma.notifiableDiseaseCase.findMany({
    where: { clinicId, ...(options.unreportedOnly ? { reportedAt: null } : {}) },
    orderBy: { diagnosedAt: 'desc' },
    take: 200,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, patientCode: true, dateOfBirth: true, sex: true } },
      diagnosedByStaff: { select: { name: true } },
      reportedByStaff: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    diseaseName: r.diseaseName,
    reporting: r.reporting,
    icd11Code: r.icd11Code,
    diagnosedAt: r.diagnosedAt,
    diagnosedBy: r.diagnosedByStaff.name,
    patientId: r.patient.id,
    patientName: `${r.patient.firstName} ${r.patient.lastName}`.trim(),
    patientCode: r.patient.patientCode,
    age: ageInYears(r.patient.dateOfBirth, r.diagnosedAt),
    sex: r.patient.sex,
    reportedAt: r.reportedAt,
    reportedBy: r.reportedByStaff?.name ?? null,
    reportNote: r.reportNote,
  }));
}

/** Immediately reportable cases not yet marked reported (for the menu badge). */
export async function countUnreportedImmediate(clinicId: string): Promise<number> {
  return prisma.notifiableDiseaseCase.count({ where: { clinicId, reporting: 'IMMEDIATE', reportedAt: null } });
}

export class NotifiableCaseNotFoundError extends Error {
  constructor() {
    super('Case not found');
  }
}

/** A doctor confirms the case was reported to the Sub-County. Once only. */
export async function markCaseReported(input: { caseId: string; clinicId: string; staffId: string; note?: string | null }): Promise<void> {
  const note = input.note?.trim().slice(0, 500) || null;
  const updated = await prisma.notifiableDiseaseCase.updateMany({
    where: { id: input.caseId, clinicId: input.clinicId, reportedAt: null },
    data: { reportedAt: new Date(), reportedByStaffId: input.staffId, reportNote: note },
  });
  if (updated.count === 0) {
    const exists = await prisma.notifiableDiseaseCase.findFirst({ where: { id: input.caseId, clinicId: input.clinicId }, select: { id: true } });
    if (!exists) throw new NotifiableCaseNotFoundError();
    return; // already reported: nothing to change
  }
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'NOTIFIABLE_CASE_REPORTED',
    entityType: 'NotifiableDiseaseCase',
    entityId: input.caseId,
  });
}

// ---- Weekly summary (counts only) -------------------------------------

/** Kenya time is UTC+3 all year (no daylight saving). */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Monday 00:00 Nairobi time of the week containing `date`, as YYYY-MM-DD. */
export function weekStartOf(date: Date): string {
  const local = new Date(date.getTime() + NAIROBI_OFFSET_MS);
  const day = (local.getUTCDay() + 6) % 7; // Monday = 0
  local.setUTCDate(local.getUTCDate() - day);
  return local.toISOString().slice(0, 10);
}

/** The last full week (Monday to Sunday) before `now`. */
export function lastFullWeekStart(now: Date = new Date()): string {
  return weekStartOf(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
}

/** UTC bounds of the Monday-Sunday week starting on `weekStart` (YYYY-MM-DD, a Monday), Nairobi time. */
export function weekBounds(weekStart: string): { from: Date; to: Date } {
  const from = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() - NAIROBI_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

export function isWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && d.getUTCDay() === 1;
}

export interface WeeklyRow {
  diseaseId: string;
  name: string;
  reporting: NotifiableReporting;
  under5: number;
  fiveAndOver: number;
  ageUnknown: number;
  total: number;
}

export interface WeeklySummary {
  clinicName: string;
  county: string | null;
  weekStart: string;
  weekEnd: string;
  rows: WeeklyRow[];
  totalCases: number;
  listConfirmed: string | null;
}

/** Cases per disease for one week, split under 5 / 5 and over. Every listed disease appears, zeros included. */
export async function weeklySummary(clinicId: string, weekStart: string): Promise<WeeklySummary> {
  const { from, to } = weekBounds(weekStart);
  const [clinic, cases] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, county: true } }),
    prisma.notifiableDiseaseCase.findMany({
      where: { clinicId, diagnosedAt: { gte: from, lt: to } },
      select: { diseaseId: true, diagnosedAt: true, patient: { select: { dateOfBirth: true } } },
    }),
  ]);
  const rows: WeeklyRow[] = NOTIFIABLE_DISEASES.map((d) => ({ diseaseId: d.id, name: d.name, reporting: d.reporting, under5: 0, fiveAndOver: 0, ageUnknown: 0, total: 0 }));
  const byId = new Map(rows.map((r) => [r.diseaseId, r]));
  for (const c of cases) {
    const row = byId.get(c.diseaseId);
    if (!row) continue; // a disease since removed from the list
    const age = ageInYears(c.patient.dateOfBirth, c.diagnosedAt);
    if (age === null) row.ageUnknown++;
    else if (age < 5) row.under5++;
    else row.fiveAndOver++;
    row.total++;
  }
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    clinicName: clinic?.name ?? '',
    county: clinic?.county ?? null,
    weekStart,
    weekEnd: end.toISOString().slice(0, 10),
    rows,
    totalCases: rows.reduce((n, r) => n + r.total, 0),
    listConfirmed: NOTIFIABLE_LIST_CONFIRMED,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function weeklySummaryCsv(s: WeeklySummary): string {
  const lines = [
    ['Clinic', s.clinicName],
    ['County', s.county ?? ''],
    ['Week', `${s.weekStart} to ${s.weekEnd} (Monday to Sunday)`],
    ['Disease list', s.listConfirmed ? `confirmed ${s.listConfirmed}` : 'DRAFT - not yet confirmed against the MOH IDSR case definitions'],
    ['Deaths', 'not recorded in ACISI'],
    [],
    ['Disease', 'Reporting', 'Cases under 5', 'Cases 5 and over', 'Age unknown', 'Total'],
    ...s.rows.map((r) => [r.name, r.reporting === 'IMMEDIATE' ? 'Immediate' : 'Weekly', r.under5, r.fiveAndOver, r.ageUnknown, r.total]),
  ];
  return `${lines.map((l) => l.map(csvCell).join(',')).join('\n')}\n`;
}
