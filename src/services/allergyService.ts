import { AllergyCategory, AllergySeverity } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { crossClinicAccessBasis } from './recordSharingService';

/**
 * Patient allergies. Doctors record them; nothing is ever deleted: an
 * allergy recorded in error is marked removed with a reason, and stays in
 * the allergy history. Who sees which: the same rule as visit records (this
 * clinic's own records always; other clinics' only on the patient's sharing
 * consent or a records code used today). The patient sees all of their own.
 */

export const ALLERGY_TEXT_MAX = 120;
export const ALLERGY_REASON_MAX = 200;

export class AllergyError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'AllergyError';
  }
}

export interface AllergyView {
  id: string;
  category: AllergyCategory;
  substance: string;
  reaction: string | null;
  severity: AllergySeverity;
  recordedAt: Date;
  recordedByName: string;
  clinicName: string;
  isOwnClinic: boolean;
  removedAt: Date | null;
  removedByName: string | null;
  removedReason: string | null;
}

const include = {
  clinic: { select: { name: true } },
  recordedByStaff: { select: { name: true } },
  removedByStaff: { select: { name: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.patientAllergy.findMany<{ include: typeof include }>>>[number];

function view(a: Row, viewingClinicId: string | null): AllergyView {
  return {
    id: a.id,
    category: a.category,
    substance: a.substance,
    reaction: a.reaction,
    severity: a.severity,
    recordedAt: a.recordedAt,
    recordedByName: a.recordedByStaff.name,
    clinicName: a.clinic.name,
    isOwnClinic: viewingClinicId !== null && a.clinicId === viewingClinicId,
    removedAt: a.removedAt,
    removedByName: a.removedByStaff?.name ?? null,
    removedReason: a.removedReason,
  };
}

/**
 * Allergies (current and removed, newest first) for a clinic: its own always,
 * other clinics' only on a sharing basis. `hiddenElsewhere` says whether
 * other clinics' allergies exist but aren't shown.
 */
export async function listAllergiesForClinic(patientId: string, clinicId: string): Promise<{ allergies: AllergyView[]; hiddenElsewhere: boolean }> {
  const rows = await prisma.patientAllergy.findMany({ where: { patientId }, orderBy: { recordedAt: 'desc' }, include });
  const others = rows.some((r) => r.clinicId !== clinicId);
  const shared = others && (await crossClinicAccessBasis(patientId, clinicId)) !== null;
  const visible = shared ? rows : rows.filter((r) => r.clinicId === clinicId);
  return { allergies: visible.map((r) => view(r, clinicId)), hiddenElsewhere: visible.length < rows.length };
}

/** The patient's own allergies, all clinics. */
export async function listOwnAllergies(patientId: string): Promise<AllergyView[]> {
  const rows = await prisma.patientAllergy.findMany({ where: { patientId }, orderBy: { recordedAt: 'desc' }, include });
  return rows.map((r) => view(r, null));
}

function cleanText(raw: string | null | undefined, max: number, label: string, required: boolean): string | null {
  const t = raw?.trim().replace(/\s+/g, ' ') ?? '';
  if (!t) {
    if (required) throw new AllergyError(`Enter the ${label}`);
    return null;
  }
  if (t.length > max) throw new AllergyError(`Keep the ${label} under ${max} characters`);
  return t;
}

export async function recordAllergy(input: {
  patientId: string;
  clinicId: string;
  staffId: string;
  category: AllergyCategory;
  substance: string;
  reaction?: string | null;
  severity: AllergySeverity;
}): Promise<AllergyView> {
  const substance = cleanText(input.substance, ALLERGY_TEXT_MAX, 'substance', true)!;
  const reaction = cleanText(input.reaction, ALLERGY_TEXT_MAX, 'reaction', false);
  const row = await prisma.patientAllergy.create({
    data: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      category: input.category,
      substance,
      reaction,
      severity: input.severity,
      recordedByStaffId: input.staffId,
    },
    include,
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'ALLERGY_RECORDED',
    entityType: 'PatientAllergy',
    entityId: row.id,
    metadata: { patientId: input.patientId, category: input.category, severity: input.severity },
  });
  return view(row, input.clinicId);
}

/** Marks an allergy recorded at this clinic as removed (kept in the history), with a reason. */
export async function removeAllergy(input: { allergyId: string; patientId: string; clinicId: string; staffId: string; reason: string }): Promise<AllergyView> {
  const reason = cleanText(input.reason, ALLERGY_REASON_MAX, 'reason', true)!;
  const existing = await prisma.patientAllergy.findFirst({ where: { id: input.allergyId, patientId: input.patientId, clinicId: input.clinicId, removedAt: null } });
  if (!existing) throw new AllergyError('Allergy not found, already removed, or recorded at another clinic', 404);
  const row = await prisma.patientAllergy.update({
    where: { id: existing.id },
    data: { removedAt: new Date(), removedByStaffId: input.staffId, removedReason: reason },
    include,
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'ALLERGY_REMOVED',
    entityType: 'PatientAllergy',
    entityId: row.id,
    metadata: { patientId: input.patientId },
  });
  return view(row, input.clinicId);
}
