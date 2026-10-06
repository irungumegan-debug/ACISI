import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { checkInWalkIn, getTodayCheckInCounts, lookupWalkInPatient, WalkInError } from '../services/walkInService';
import { patientIdentityInputSchema } from '../services/patientIdentity';

export const walkInRouter = Router();

walkInRouter.use(requireStaffSession);

/**
 * Walk-in check-in is a front-desk job: receptionists, clinicians and
 * admins. Doctors work from their own queue and are refused here, on the
 * server and not just by hiding the button.
 */
function requireFrontDesk(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).dashboardSession.role === 'DOCTOR') {
    res.status(403).json({ error: 'Only front-desk staff can check in walk-in patients' });
    return;
  }
  next();
}

walkInRouter.use(requireFrontDesk);

function sendWalkInError(err: unknown, res: Response): boolean {
  if (err instanceof WalkInError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/** Step 1: look a patient up by phone number (any Kenyan format). */
walkInRouter.get('/lookup', async (req, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
  if (!phone.trim()) {
    res.status(400).json({ error: 'Enter a phone number' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await lookupWalkInPatient(phone, clinicId, staffId));
  } catch (err) {
    if (!sendWalkInError(err, res)) throw err;
  }
});

const newPatientSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the patient's full name").max(100),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth').optional(),
  age: z.coerce.number().int('Age must be a whole number').min(0).max(120).optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional(),
  registrationConsent: z.boolean(),
});

const checkInSchema = z.object({
  phone: z.string().trim().min(1, 'Enter a phone number').max(20),
  departmentId: z.string().trim().min(1, 'Choose a department'),
  reasonForVisit: z.string().trim().min(2, 'Enter the reason for the visit').max(200, 'Keep the reason under 200 characters'),
  newPatient: newPatientSchema.optional(),
  smsConsent: z.boolean().default(false),
  smsOptOut: z.boolean().default(false),
  /** "Patient has been told how their data is used and where to read the Privacy Notice." */
  privacyNoticeExplained: z.boolean().default(false),
  /** Optional ID document and next of kin; empty fields leave what's on file alone. */
  identity: patientIdentityInputSchema.optional(),
});

/** Step 2: add the patient (found or newly registered) to today's queue. No fee, no payment prompt. */
walkInRouter.post('/', async (req, res) => {
  const parsed = checkInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    const result = await checkInWalkIn({ ...parsed.data, clinicId, staffId });
    res.status(201).json(result);
  } catch (err) {
    if (!sendWalkInError(err, res)) throw err;
  }
});

/** Today's walk-in vs remote check-in counts for the queue page. */
walkInRouter.get('/stats/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  res.json(await getTodayCheckInCounts(clinicId));
});
