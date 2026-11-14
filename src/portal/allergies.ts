import { Router } from 'express';
import { AuthenticatedPatientRequest, requirePatientSession } from './auth';
import { listOwnAllergies } from '../services/allergyService';

/** The patient's own allergies, from every clinic (read-only; doctors record them). */
export const portalAllergiesRouter = Router();

portalAllergiesRouter.use(requirePatientSession);

portalAllergiesRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  res.json({ allergies: await listOwnAllergies(patientId) });
});
