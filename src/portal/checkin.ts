import { Router } from 'express';
import { z } from 'zod';
import { Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { listActiveClinics, getActiveClinicById } from '../services/clinicService';
import { listActiveDepartments, getActiveDepartmentById } from '../services/departmentService';
import { findPatientByPhone, registerPatient } from '../services/patientService';
import { initiateCheckIn } from '../services/checkInService';
import { listTodayQueue } from '../services/consultationService';

export const portalCheckinRouter = Router();

/** Real, onboarded clinic list — same one the USSD clinic-selection screen reads. */
portalCheckinRouter.get('/clinics', async (_req, res) => {
  const clinics = await listActiveClinics();
  res.json({ clinics });
});

/** Same canonical department list as USSD and the staff dashboard filter. */
portalCheckinRouter.get('/departments', async (_req, res) => {
  const departments = await listActiveDepartments();
  res.json({ departments });
});

/** So the portal shows the real fee instead of hardcoding it, same value the USSD confirm prompt uses. */
portalCheckinRouter.get('/fee', (_req, res) => {
  res.json({ checkInFeeKes: env.CHECKIN_FEE_AMOUNT_KES });
});

const CURRENT_YEAR = new Date().getFullYear();

const registrationSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  birthYear: z.number().int().min(1900).max(CURRENT_YEAR),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']),
  consent: z.literal(true),
});

const checkinSchema = z.object({
  clinicId: z.string().min(1),
  departmentId: z.string().min(1),
  phoneNumber: z.string().min(1),
  /** Client-generated per-attempt id, reused as the CheckIn idempotency key (see the comment on CheckIn.ussdSessionId) so a double-submitted request can never trigger a second STK push. */
  clientRequestId: z.string().min(1),
  registration: registrationSchema.optional(),
});

/**
 * Web equivalent of the USSD check-in flow, calling the exact same
 * checkInService/M-Pesa STK push used there — no separate billing path.
 * A brand-new phone number needs the same consent + registration step USSD
 * collects; when the client hasn't sent `registration` yet, this responds
 * with REGISTRATION_REQUIRED instead of erroring, so the portal can show a
 * short sign-up form and resubmit.
 */
portalCheckinRouter.post('/checkin', async (req, res) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid check-in details' });
    return;
  }

  let phoneE164: string;
  try {
    phoneE164 = toE164(parsed.data.phoneNumber);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }
    throw err;
  }

  const clinic = await getActiveClinicById(parsed.data.clinicId);
  if (!clinic) {
    res.status(400).json({ error: 'Select a valid clinic' });
    return;
  }

  const department = await getActiveDepartmentById(parsed.data.departmentId);
  if (!department) {
    res.status(400).json({ error: 'Select a valid department' });
    return;
  }

  let patient = await findPatientByPhone(phoneE164);
  if (!patient) {
    if (!parsed.data.registration) {
      res.json({ status: 'REGISTRATION_REQUIRED' });
      return;
    }

    const reg = parsed.data.registration;
    try {
      patient = await registerPatient({
        phoneNumberE164: phoneE164,
        firstName: reg.firstName,
        lastName: reg.lastName,
        dateOfBirth: new Date(Date.UTC(reg.birthYear, 0, 1)),
        sex: reg.sex as Sex,
        consentChannel: 'WEB_PORTAL',
      });
    } catch (err) {
      logger.error({ err }, 'Failed to register new patient during web check-in');
      res.status(500).json({ error: 'Something went wrong registering you. Please try again shortly.' });
      return;
    }
  }

  try {
    const { checkIn } = await initiateCheckIn({
      // Same unique idempotency column USSD uses, just sourced from the
      // portal's own per-attempt id instead of an Africa's Talking sessionId.
      ussdSessionId: `web:${parsed.data.clientRequestId}`,
      patientId: patient.id,
      clinicId: clinic.id,
      clinicName: clinic.name,
      departmentId: department.id,
      channel: 'WEB',
      phoneNumberE164: phoneE164,
    });

    if (checkIn.status === 'FAILED') {
      res.status(502).json({ error: 'We could not start the payment request. Please try again shortly.' });
      return;
    }

    res.json({ status: 'PAYMENT_PENDING', checkInId: checkIn.id });
  } catch (err) {
    logger.error({ err }, 'Failed to initiate web check-in');
    res.status(502).json({ error: 'We could not start the payment request. Please try again shortly.' });
  }
});

/**
 * Polled by the portal's "waiting for M-Pesa" screen — the STK push result
 * arrives asynchronously via the Daraja callback, same as USSD. Returns only
 * payment status and queue position, nothing patient-identifying, so it's
 * safe to leave unauthenticated (the checkInId itself isn't guessable).
 */
portalCheckinRouter.get('/checkin/:checkInId/status', async (req, res) => {
  const checkIn = await prisma.checkIn.findUnique({
    where: { id: req.params.checkInId as string },
    include: { encounter: true },
  });

  if (!checkIn) {
    res.status(404).json({ error: 'Check-in not found' });
    return;
  }

  if (checkIn.status !== 'PAID' || !checkIn.encounter) {
    res.json({ status: checkIn.status });
    return;
  }

  const queue = await listTodayQueue(checkIn.clinicId, checkIn.departmentId ?? undefined);
  const waitingAhead = queue.filter((item) => item.consultationStatus === 'WAITING');
  const position = waitingAhead.findIndex((item) => item.encounterId === checkIn.encounter!.id) + 1;

  res.json({ status: 'PAID', queuePosition: position > 0 ? position : null });
});
