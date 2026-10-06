import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import { identityView } from '../services/patientIdentity';

export const portalDetailsRouter = Router();

portalDetailsRouter.use(requirePatientSession);

/** The patient's own ID document and next of kin, to pre-fill the check-in form. */
portalDetailsRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null } });
  if (!patient) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json(identityView(patient));
});
