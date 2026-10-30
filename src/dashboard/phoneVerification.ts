import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { prisma } from '../db/prisma';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { completePendingSignupInPerson, findPendingSignupsByPhone, PendingSignupError } from '../services/pendingSignupService';
import { issueInPersonSetupCode } from '../services/otpService';

/**
 * C3 fallback when SMS can't be sent: front desk confirms a patient holds
 * their phone by ringing it in front of them, then either finishes a
 * pending web signup or shows a one-time setup code for the patient's first
 * PIN. Front-desk roles only; every step is audit-logged.
 */
export const phoneVerificationRouter = Router();

phoneVerificationRouter.use(requireStaffSession);

function requireFrontDesk(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).dashboardSession.role === 'DOCTOR') {
    res.status(403).json({ error: 'Phone verification is done at the front desk' });
    return;
  }
  next();
}
phoneVerificationRouter.use(requireFrontDesk);

const confirmedSchema = z.object({ phoneConfirmedInPerson: z.literal(true) });
const NOT_CONFIRMED = 'Ring the patient\'s number and tick "The phone rang in front of me" first';

/** Pending web signups for a phone number: names only, to confirm it's the right person. */
phoneVerificationRouter.get('/pending-signups', async (req, res) => {
  const { staffId, clinicId } = (req as AuthenticatedRequest).dashboardSession;
  let phone: string;
  try {
    phone = toE164(typeof req.query.phone === 'string' ? req.query.phone : '');
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Enter a valid phone number' });
      return;
    }
    throw err;
  }
  res.json({ phoneNumber: phone, signups: await findPendingSignupsByPhone(phone, staffId, clinicId) });
});

/** "Finish setup" for a pending web signup, after ringing the number. The patient then logs in with the PIN they chose. */
phoneVerificationRouter.post('/pending-signups/:id/complete', async (req, res) => {
  if (!confirmedSchema.safeParse(req.body).success) {
    res.status(400).json({ error: NOT_CONFIRMED });
    return;
  }
  const { staffId, clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    const patient = await completePendingSignupInPerson(req.params.id as string, staffId, clinicId);
    res.status(201).json({ patientCode: patient.patientCode });
  } catch (err) {
    if (err instanceof PendingSignupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/**
 * A one-time setup code for a patient this clinic has seen (e.g. a walk-in)
 * who wants portal access but can't get the SMS. Shown on screen once.
 */
phoneVerificationRouter.post('/patients/:id/setup-code', async (req, res) => {
  if (!confirmedSchema.safeParse(req.body).success) {
    res.status(400).json({ error: NOT_CONFIRMED });
    return;
  }
  const { staffId, clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const patient = await prisma.patient.findFirst({
    where: { id: req.params.id, deletedAt: null, OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] },
    select: { id: true, patientCode: true },
  });
  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }
  const { code, expiresAt } = await issueInPersonSetupCode(patient.id, staffId, clinicId);
  res.status(201).json({ code, expiresAt, patientCode: patient.patientCode });
});
