import { Router } from 'express';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { revokeSessionsFor } from '../services/sessionRevocation';
import { AuthenticatedOwnerRequest } from './auth';

export const ownerStaffRouter = Router();

/**
 * Staff are deactivated, never erased: their name stays on the visits they
 * consulted and checked out, which clinics need for medical accountability.
 * Deactivation blocks login (findActiveStaff*), stops new visits being
 * assigned to them (doctorAssignmentService), and logs them out now.
 */
async function setStaffActive(req: AuthenticatedOwnerRequest, isActive: boolean) {
  const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!staff) return null;

  const updated = await prisma.staff.update({ where: { id: staff.id }, data: { isActive } });
  if (!isActive) {
    await revokeSessionsFor(`staff:${staff.id}`);
  }

  await recordAuditEvent({
    actorType: 'OWNER',
    actorId: req.ownerSession.ownerId,
    action: isActive ? 'OWNER_STAFF_REACTIVATED' : 'OWNER_STAFF_DEACTIVATED',
    entityType: 'Staff',
    entityId: staff.id,
  });

  return updated;
}

ownerStaffRouter.post('/:id/deactivate', async (req, res) => {
  const staff = await setStaffActive(req as unknown as AuthenticatedOwnerRequest, false);
  if (!staff) {
    res.status(404).json({ error: 'Staff member not found' });
    return;
  }
  res.json({ id: staff.id, isActive: staff.isActive });
});

ownerStaffRouter.post('/:id/reactivate', async (req, res) => {
  const staff = await setStaffActive(req as unknown as AuthenticatedOwnerRequest, true);
  if (!staff) {
    res.status(404).json({ error: 'Staff member not found' });
    return;
  }
  res.json({ id: staff.id, isActive: staff.isActive });
});
