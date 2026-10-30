import { Response, Router } from 'express';
import { z } from 'zod';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import { getSharingOverview, RecordSharingError, setStandingSharing, showCodeToPatient } from '../services/recordSharingService';

/**
 * The patient's own control over who sees their records from other clinics
 * (Account tab): the standing switch, clinics with access today, every
 * decision with date and source, and "Request records" codes from clinics.
 */
export const portalSharingRouter = Router();

portalSharingRouter.use(requirePatientSession);

function patientIdOf(req: unknown): string {
  return (req as AuthenticatedPatientRequest).patientSession.patientId;
}

function sendError(err: unknown, res: Response): boolean {
  if (err instanceof RecordSharingError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

portalSharingRouter.get('/', async (req, res) => {
  res.json(await getSharingOverview(patientIdOf(req)));
});

const switchSchema = z.object({ allowSharing: z.boolean() });

/** The Account-tab switch. Every change is saved as a new decision with date, time and source. */
portalSharingRouter.put('/', async (req, res) => {
  const parsed = switchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'allowSharing must be true or false' });
    return;
  }
  await setStandingSharing(patientIdOf(req), parsed.data.allowSharing);
  res.json(await getSharingOverview(patientIdOf(req)));
});

/** "Show my code" for a clinic's request: a fresh 10-minute code, shown once. */
portalSharingRouter.post('/requests/:requestId/code', async (req, res) => {
  try {
    res.json(await showCodeToPatient(patientIdOf(req), req.params.requestId as string));
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
});
