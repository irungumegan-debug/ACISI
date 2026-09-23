import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import { regenerateInviteCode } from '../services/clinicService';
import { InvalidPinFormatError, StaffNotFoundError, listClinicStaff, resetStaffPinByAdmin } from '../services/staffService';

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

clinicSettingsRouter.get('/staff', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const staff = await listClinicStaff(clinicId);
  res.json({ staff });
});

const resetPinSchema = z.object({ newPin: z.string().optional() });

/**
 * Resets one staff/doctor's PIN, scoped to the requesting admin's own
 * clinic. Returns the new PIN in plaintext exactly once, for the admin to
 * relay directly — never stored or logged in that form anywhere.
 */
clinicSettingsRouter.post('/staff/:id/reset-pin', async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await resetStaffPinByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      newPin: parsed.data.newPin,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidPinFormatError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
