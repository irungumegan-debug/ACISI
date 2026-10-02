import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { deletePatientAccount, PatientNotFoundError } from '../services/patientDeletionService';
import { AuthenticatedOwnerRequest } from './auth';

export const ownerPatientsRouter = Router();

const deleteSchema = z.object({ patientCode: z.string().min(1) });

/**
 * The owner site's only patient feature: delete an account by its patient
 * ID (e.g. "ACI-7F2K"), for a patient who asks but can't do it themselves
 * from the portal. Deliberately returns nothing about the patient — no
 * name, contact details or records — so the owner site never displays
 * patient data. See patientDeletionService for what's wiped and what's
 * kept; the deletion itself is audit-logged there.
 */
ownerPatientsRouter.post('/delete', async (req, res) => {
  const { ownerId } = (req as unknown as AuthenticatedOwnerRequest).ownerSession;
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter the patient ID, e.g. ACI-7F2K' });
    return;
  }

  const patientCode = parsed.data.patientCode.trim().toUpperCase();
  const patient = await prisma.patient.findFirst({ where: { patientCode, deletedAt: null }, select: { id: true } });
  if (!patient) {
    res.status(404).json({ error: 'No active account has that patient ID' });
    return;
  }

  try {
    await deletePatientAccount(patient.id, { type: 'OWNER', ownerId });
  } catch (err) {
    if (err instanceof PatientNotFoundError) {
      res.status(404).json({ error: 'No active account has that patient ID' });
      return;
    }
    throw err;
  }

  res.status(204).send();
});
