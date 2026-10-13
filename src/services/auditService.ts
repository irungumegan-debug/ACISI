import { prisma } from '../db/prisma';
import { ActorType } from '@prisma/client';

interface RecordAuditEventInput {
  actorType: ActorType;
  actorId?: string;
  staffId?: string;
  /** The clinic the action happened at, when there is one. */
  clinicId?: string;
  /** The patient whose data was touched, when there is one. */
  patientId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes one append-only audit row. This is the Data Protection Act audit
 * trail — call it for every access to or mutation of patient data, not just
 * for security-sensitive events. Record who (actor), which clinic, which
 * patient and what; never phone numbers, PINs, codes or record contents.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      // Most patient events use the patient as their entity; fill it in so
      // "everything that happened to this patient" is one indexed query.
      patientId: input.patientId ?? (input.entityType === 'Patient' ? input.entityId : undefined),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as never,
    },
  });
}
