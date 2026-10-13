import { Router } from 'express';
import { AuthenticatedPatientRequest, requirePatientSession } from './auth';
import { listRecordAccess, revokeAllClinicsSharing, revokeClinicRecordAccess } from '../services/recordAccessService';

/**
 * The patient's own view of who can see their records from other clinics,
 * and the switch to take that access away. Revoking writes a new consent
 * row (never edits the old one) and an audit row.
 */
export const portalRecordAccessRouter = Router();

portalRecordAccessRouter.use(requirePatientSession);

portalRecordAccessRouter.get('/', async (req, res) => {
  res.json(await listRecordAccess((req as AuthenticatedPatientRequest).patientSession.patientId));
});

portalRecordAccessRouter.post('/all-clinics/revoke', async (req, res) => {
  await revokeAllClinicsSharing((req as AuthenticatedPatientRequest).patientSession.patientId);
  res.status(204).send();
});

portalRecordAccessRouter.post('/:clinicId/revoke', async (req, res) => {
  const { patientId } = (req as unknown as AuthenticatedPatientRequest).patientSession;
  const { clinics } = await listRecordAccess(patientId);
  if (!clinics.some((c) => c.clinicId === req.params.clinicId)) {
    res.status(404).json({ error: 'That clinic does not have access' });
    return;
  }
  await revokeClinicRecordAccess(patientId, req.params.clinicId as string);
  res.status(204).send();
});
