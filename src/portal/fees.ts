import { Router } from 'express';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import { getFeeStatus } from '../services/feeService';
import { NothingOwedError, payOutstandingFees } from '../services/checkInService';

/**
 * The patient's unpaid ACISI check-in fee (C20): shown on their profile with
 * a Pay button. Always available, including while the account is restricted.
 */
export const portalFeesRouter = Router();

portalFeesRouter.use(requirePatientSession);

portalFeesRouter.get('/', async (req, res) => {
  res.json(await getFeeStatus((req as AuthenticatedPatientRequest).patientSession.patientId));
});

/** One M-Pesa prompt for everything owed; paying lifts a restriction straight away. */
portalFeesRouter.post('/pay', async (req, res) => {
  try {
    res.status(201).json(await payOutstandingFees((req as AuthenticatedPatientRequest).patientSession.patientId));
  } catch (err) {
    if (err instanceof NothingOwedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
