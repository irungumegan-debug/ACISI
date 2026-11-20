import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';

/**
 * Family history: one free-text note on the patient (e.g. "Mother: type 2
 * diabetes; father: hypertension, died of stroke at 60"), kept by doctors.
 * Encrypted at rest. Same visibility as the patient's record.
 */

export const FAMILY_HISTORY_MAX = 1000;

export class FamilyHistoryError extends Error {}

export async function setFamilyHistory(input: { patientId: string; clinicId: string; staffId: string; text: string | null }): Promise<{ familyHistory: string | null }> {
  const text = input.text?.trim().replace(/[ \t]+/g, ' ') || null;
  if (text && text.length > FAMILY_HISTORY_MAX) throw new FamilyHistoryError(`Keep it under ${FAMILY_HISTORY_MAX} characters`);
  await prisma.patient.update({ where: { id: input.patientId }, data: { familyHistory: text } });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: text ? 'FAMILY_HISTORY_UPDATED' : 'FAMILY_HISTORY_CLEARED',
    entityType: 'Patient',
    entityId: input.patientId,
  });
  return { familyHistory: text };
}
