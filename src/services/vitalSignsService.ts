import { VitalSigns } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { ageInMonths, assessVitals, bmi, VitalValues, VitalWarning, vitalInputProblems } from './vitalAssessment';

/**
 * Vital signs per visit: recorded at triage (front desk) or by the doctor,
 * shown with BMI and age-adjusted warnings, and as a trend over the
 * patient's visits at this clinic. Readings are never edited or deleted: a
 * wrong one is corrected by recording a new set.
 */

export class VitalSignsError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'VitalSignsError';
  }
}

export interface VitalSignsView extends Required<{ [K in keyof VitalValues]: number | null }> {
  id: string;
  encounterId: string;
  recordedAt: Date;
  recordedByName: string;
  bmi: number | null;
  warnings: VitalWarning[];
}

const FIELDS = ['systolic', 'diastolic', 'pulse', 'respiratoryRate', 'temperatureC', 'oxygenSaturation', 'weightKg', 'heightCm', 'muacCm'] as const;

function toView(row: VitalSigns, staffName: string, dob: Date | null): VitalSignsView {
  const values = Object.fromEntries(FIELDS.map((f) => [f, row[f]])) as Required<{ [K in keyof VitalValues]: number | null }>;
  return {
    id: row.id,
    encounterId: row.encounterId,
    recordedAt: row.recordedAt,
    recordedByName: staffName,
    ...values,
    bmi: bmi(row.weightKg, row.heightCm),
    warnings: assessVitals(values, ageInMonths(dob, row.recordedAt)),
  };
}

async function views(rows: VitalSigns[], dob: Date | null): Promise<VitalSignsView[]> {
  const staff = await prisma.staff.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedByStaffId))] } }, select: { id: true, name: true } });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return rows.map((r) => toView(r, names.get(r.recordedByStaffId) ?? 'Staff', dob));
}

/** This visit's readings, and the patient's earlier readings at this clinic (newest first, for the trend). */
export async function getVitalSigns(encounterId: string, clinicId: string): Promise<{ thisVisit: VitalSignsView[]; history: VitalSignsView[] }> {
  const encounter = await prisma.encounter.findFirst({ where: { id: encounterId, clinicId }, select: { id: true, patientId: true, patient: { select: { dateOfBirth: true } } } });
  if (!encounter) throw new VitalSignsError('Visit not found', 404);
  const rows = await prisma.vitalSigns.findMany({
    where: { patientId: encounter.patientId, clinicId },
    orderBy: { recordedAt: 'desc' },
    take: 50,
  });
  const all = await views(rows, encounter.patient.dateOfBirth);
  return { thisVisit: all.filter((v) => v.encounterId === encounter.id), history: all.filter((v) => v.encounterId !== encounter.id) };
}

export async function recordVitalSigns(input: { encounterId: string; clinicId: string; staffId: string; values: VitalValues }) {
  const problems = vitalInputProblems(input.values);
  if (problems.length) throw new VitalSignsError(problems[0]!);
  const encounter = await prisma.encounter.findFirst({ where: { id: input.encounterId, clinicId: input.clinicId }, select: { id: true, patientId: true, status: true } });
  if (!encounter) throw new VitalSignsError('Visit not found', 404);
  if (encounter.status === 'DONE') throw new VitalSignsError('This visit is finished', 409);
  const data = Object.fromEntries(FIELDS.map((f) => [f, input.values[f] ?? null]));
  const row = await prisma.vitalSigns.create({
    data: { ...data, encounterId: encounter.id, clinicId: input.clinicId, patientId: encounter.patientId, recordedByStaffId: input.staffId },
  });
  const result = await getVitalSigns(encounter.id, input.clinicId);
  const recorded = result.thisVisit.find((v) => v.id === row.id);
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'VITAL_SIGNS_RECORDED',
    entityType: 'Encounter',
    entityId: encounter.id,
    metadata: { patientId: encounter.patientId, fields: FIELDS.filter((f) => input.values[f] != null), warnings: recorded?.warnings.length ?? 0 },
  });
  return result;
}
