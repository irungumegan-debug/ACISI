import { Router } from 'express';
import { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

export const ownerActivityRouter = Router();

const PAGE_SIZE = 50;

export interface ActivityEntry {
  id: string;
  actorType: AuditLog['actorType'];
  actorId: string | null;
  /** Human-readable actor: a staff member's name and clinic, the owner's name, or a patient code. */
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

/**
 * Resolves each row's actor to something a person can read. Actor ids are
 * polymorphic (Staff.id, Patient.id or PlatformOwner.id by actorType), so
 * this batches one lookup per actor type rather than a join.
 */
export async function describeAuditLogs(rows: AuditLog[]): Promise<ActivityEntry[]> {
  const idsOf = (type: AuditLog['actorType']) =>
    [...new Set(rows.filter((r) => r.actorType === type && r.actorId).map((r) => r.actorId as string))];

  const [staff, patients, owners] = await Promise.all([
    prisma.staff.findMany({ where: { id: { in: idsOf('STAFF') } }, include: { clinic: { select: { name: true } } } }),
    prisma.patient.findMany({ where: { id: { in: idsOf('PATIENT') } }, select: { id: true, patientCode: true } }),
    prisma.platformOwner.findMany({ where: { id: { in: idsOf('OWNER') } }, select: { id: true, name: true } }),
  ]);

  const labels = new Map<string, string>([
    ...staff.map((s): [string, string] => [s.id, `${s.name} (${s.clinic.name})`]),
    ...patients.map((p): [string, string] => [p.id, `Patient ${p.patientCode}`]),
    ...owners.map((o): [string, string] => [o.id, `${o.name} (owner)`]),
  ]);

  return rows.map((r) => ({
    id: r.id,
    actorType: r.actorType,
    actorId: r.actorId,
    actorLabel: r.actorType === 'SYSTEM' ? 'System' : (r.actorId && labels.get(r.actorId)) || 'Unknown',
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata,
    createdAt: r.createdAt,
  }));
}

/**
 * The full audit trail, newest first. Read-only — like everything else
 * touching AuditLog, there's no route that edits or deletes a row.
 * Paginated by `before` (an ISO timestamp from the previous page's last row).
 */
ownerActivityRouter.get('/', async (req, res) => {
  const actorType = typeof req.query.actorType === 'string' ? req.query.actorType : undefined;
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : undefined;

  const where: Prisma.AuditLogWhereInput = {};
  if (actorType && ['PATIENT', 'STAFF', 'SYSTEM', 'OWNER'].includes(actorType)) {
    where.actorType = actorType as AuditLog['actorType'];
  }
  if (before && !Number.isNaN(before.getTime())) {
    where.createdAt = { lt: before };
  }

  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE });
  res.json({ entries: await describeAuditLogs(rows), hasMore: rows.length === PAGE_SIZE });
});
