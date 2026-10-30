import { prisma } from '../db/prisma';
import { ActorType } from '@prisma/client';
import { logger } from '../utils/logger';

interface RecordAuditEventInput {
  actorType: ActorType;
  actorId?: string;
  staffId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  /**
   * The clinic the action happened at. Optional: when left out it is taken
   * from metadata.clinicId / metadata.viewedByClinicId, or from the acting
   * staff member's clinic. Stays null for actions with no clinic (patient
   * self-service, the owner).
   */
  clinicId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Metadata keys that could carry personal or clinical details. Audit
 * details hold IDs and statuses only; anything under one of these keys is
 * dropped before writing, whatever a caller passes.
 */
const FORBIDDEN_METADATA_KEY = /name|phone|msisdn|email|diagnos|prescri|reason|note|idnumber|nextofkin|address|dob|dateofbirth|testname/i;

/** Returns metadata with every forbidden key removed (recursively), plus the keys that were removed. */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined): {
  clean: Record<string, unknown> | undefined;
  removed: string[];
} {
  if (!metadata) return { clean: undefined, removed: [] };
  const removed: string[] = [];
  const walk = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_METADATA_KEY.test(k)) {
        removed.push(path ? `${path}.${k}` : k);
        continue;
      }
      out[k] = walk(v, path ? `${path}.${k}` : k);
    }
    return out;
  };
  return { clean: walk(metadata, '') as Record<string, unknown>, removed };
}

async function resolveClinicId(input: RecordAuditEventInput): Promise<string | null> {
  if (input.clinicId !== undefined) return input.clinicId;
  const fromMetadata = input.metadata?.clinicId ?? input.metadata?.viewedByClinicId;
  if (typeof fromMetadata === 'string') return fromMetadata;
  if (input.staffId) {
    const staff = await prisma.staff.findUnique({ where: { id: input.staffId }, select: { clinicId: true } });
    return staff?.clinicId ?? null;
  }
  return null;
}

/**
 * Writes one append-only audit row. This is the Data Protection Act audit
 * trail — call it for every access to or mutation of patient data, not just
 * for security-sensitive events. Details (metadata) carry IDs and statuses
 * only: never names, phone numbers, diagnoses, prescriptions or free text.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const { clean, removed } = sanitizeAuditMetadata(input.metadata);
  if (removed.length) {
    // Key names only, never values.
    logger.warn({ action: input.action, removedKeys: removed }, 'Audit metadata keys removed');
  }
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      staffId: input.staffId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      clinicId: await resolveClinicId(input),
      metadata: clean as never,
    },
  });
}
