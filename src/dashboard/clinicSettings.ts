import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import { regenerateInviteCode } from '../services/clinicService';

export const clinicSettingsRouter = Router();

clinicSettingsRouter.use(requireStaffSession, requireAdmin);

clinicSettingsRouter.get('/invite-code', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { inviteCode: true } });
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  res.json({ inviteCode: clinic.inviteCode });
});

clinicSettingsRouter.post('/invite-code/regenerate', async (req, res) => {
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const inviteCode = await regenerateInviteCode(clinicId, staffId);
  res.json({ inviteCode });
});
