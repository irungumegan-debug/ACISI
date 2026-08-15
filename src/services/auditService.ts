import { prisma } from '../db/prisma';
import { ActorType } from '@prisma/client';

interface RecordAuditEventInput {
  actorType: ActorType;
  actorId?: string;
  staffId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes one append-only audit row. This is the Data Protection Act audit
 * trail — call it for every access to or mutation of patient data, not just
 * for security-sensitive events.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      staffId: input.staffId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as never,
    },
  });
}
