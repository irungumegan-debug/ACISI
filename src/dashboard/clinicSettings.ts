import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import { regenerateInviteCode } from '../services/clinicService';
import {
  AccountAlreadyInStateError,
  InvalidPinFormatError,
  LastActiveAdminError,
  StaffIsNotADoctorError,
  StaffNotFoundError,
  deactivateStaffAccount,
  listClinicStaff,
  reactivateStaffAccount,
  resetStaffPinByAdmin,
  setDoctorPresenceByAdmin,
} from '../services/staffService';

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

const presenceSchema = z.object({ status: z.enum(['IN', 'OUT']) });

/** Lets a clinic admin mark one of their own doctors in/out for today, e.g. on a doctor's behalf for a planned absence. */
clinicSettingsRouter.post('/staff/:id/presence', async (req, res) => {
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be IN or OUT' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await setDoctorPresenceByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      status: parsed.data.status,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof StaffIsNotADoctorError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/**
 * Deactivates a staff/doctor account — never deletes the row, so every
 * Encounter/CheckIn/Appointment they touched keeps pointing at them. Blocked
 * when the target is the clinic's last active admin (see
 * staffService.LastActiveAdminError), whether the admin is deactivating
 * themselves or another admin.
 */
clinicSettingsRouter.post('/staff/:id/deactivate', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await deactivateStaffAccount({ clinicId, targetStaffId: req.params.id as string, requestedByStaffId: staffId });
    res.json({ id: result.id, status: result.isActive ? 'ACTIVE' : 'DEACTIVATED' });
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof LastActiveAdminError || err instanceof AccountAlreadyInStateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

clinicSettingsRouter.post('/staff/:id/reactivate', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await reactivateStaffAccount({ clinicId, targetStaffId: req.params.id as string, requestedByStaffId: staffId });
    res.json({ id: result.id, status: result.isActive ? 'ACTIVE' : 'DEACTIVATED' });
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof AccountAlreadyInStateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
