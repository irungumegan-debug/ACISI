import { Router } from 'express';
import { AuthenticatedPatientRequest, requirePatientSession } from './auth';
import { getVisitsToday } from '../services/queueStatusService';

/**
 * The patient's visits in progress today, however they checked in (walk-in,
 * portal or USSD): stage and live place in the queue. The portal asks again
 * every 20 seconds while the page is open.
 */
export const portalVisitTodayRouter = Router();

portalVisitTodayRouter.use(requirePatientSession);

portalVisitTodayRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  res.json({ visits: await getVisitsToday(patientId) });
});
