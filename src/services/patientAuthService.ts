import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { OtpPurpose, Patient, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis } from '../config/redis';
import { env } from '../config/env';
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  PATIENT_OTP_MAX_SENDS_PER_HOUR,
  PATIENT_OTP_TTL_SECONDS,
  PATIENT_PIN_LOCK_MINUTES,
  PATIENT_PIN_MAX_ATTEMPTS,
  PATIENT_SETUP_FLOW_TTL_SECONDS,
  PATIENT_SETUP_MAX_DOB_ATTEMPTS,
} from '../config/constants';
import { generateOtpCode, looksLikePatientCode } from '../utils/idCodes';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { pinPolicyError } from '../utils/pinPolicy';
import { formatDateOfBirth, parseDateOfBirth } from '../utils/patientInput';
import { recordAuditEvent } from './auditService';
import { DuplicatePatientError, findPatientByCode, findPatientsByPhone, registerPatient } from './patientService';
import { sendSms } from './smsSender';
import { revokeSessionsFor } from './sessionRevocation';

/**
 * Patient portal sign-in. Patients get exactly one OTP — at their first
 * login (or the first after we introduced PINs) — and after that log in
 * with phone number or ACISI ID + a 6-digit PIN, with no SMS. The only
 * other OTP is "forgot PIN".
 *
 *   OTP flow:   phone → code by SMS → pick which person (shared phones)
 *               → confirm date of birth → set PIN → see ACISI ID
 *   Every day:  phone or ACISI ID + PIN
 *
 * The date-of-birth step protects against Safaricom recycling an old number
 * to a new owner: owning the phone alone is not enough.
 */

/** A problem the patient can act on; carries the HTTP status the route should use. */
export class PatientAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 404 | 409 | 429,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PatientAuthError';
  }
}

// --- OTP -------------------------------------------------------------------

export type OtpRequestPurpose = 'login' | 'reset';

function otpPurpose(p: OtpRequestPurpose): OtpPurpose {
  return p === 'reset' ? 'PIN_RESET' : 'FIRST_LOGIN';
}

export function normalisePhone(raw: string): string {
  try {
    return toE164(raw);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) throw new PatientAuthError('Enter a valid Kenyan phone number, e.g. 0712 345 678', 400);
    throw err;
  }
}

/**
 * Sends a 6-digit code (5 minutes, single use). At most 3 per phone per
 * hour, counted from stored rows so a restart doesn't reset it. A reset
 * code is only sent to a phone that has an account; a first-login code is
 * sent to any valid phone, since a patient with no account yet can sign up
 * after confirming their phone. The response never says which.
 */
export async function requestPatientOtp(rawPhone: string, purpose: OtpRequestPurpose, now = new Date()): Promise<void> {
  const phoneNumber = normalisePhone(rawPhone);
  const sentLastHour = await prisma.phoneOtp.count({ where: { phoneNumber, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } });
  if (sentLastHour >= PATIENT_OTP_MAX_SENDS_PER_HOUR) {
    throw new PatientAuthError('Too many codes requested for this number. Try again in an hour.', 429);
  }
  const patients = await findPatientsByPhone(phoneNumber);
  if (purpose === 'reset' && patients.length === 0) return;

  const code = generateOtpCode();
  const otp = await prisma.phoneOtp.create({
    data: {
      phoneNumber,
      purpose: otpPurpose(purpose),
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(now.getTime() + PATIENT_OTP_TTL_SECONDS * 1000),
    },
  });
  const message = `Your ACISI code is ${code}. It expires in ${Math.round(PATIENT_OTP_TTL_SECONDS / 60)} minutes. Never share it with anyone.`;
  await sendSms(phoneNumber, message, { purpose: purpose === 'reset' ? 'otp-reset' : 'otp-login' });
  for (const p of patients) {
    await recordAuditEvent({
      actorType: 'PATIENT',
      actorId: p.id,
      patientId: p.id,
      action: purpose === 'reset' ? 'PIN_RESET_OTP_REQUESTED' : 'FIRST_LOGIN_OTP_REQUESTED',
      entityType: 'PhoneOtp',
      entityId: otp.id,
    });
  }
}

/**
 * Checks a code against the newest unused, unexpired code for this phone
 * and purpose. A match uses the code up; a miss counts towards the 5
 * allowed guesses.
 */
export async function verifyPatientOtp(phoneNumber: string, purpose: OtpRequestPurpose, code: string, now = new Date()): Promise<boolean> {
  const otp = await prisma.phoneOtp.findFirst({
    where: { phoneNumber, purpose: otpPurpose(purpose), consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.attempts >= OTP_MAX_VERIFY_ATTEMPTS) return false;
  if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, otp.codeHash))) {
    await prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  // Conditional, so two simultaneous submissions can't both use the same code.
  const used = await prisma.phoneOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
  return used.count === 1;
}

// --- Setup flow (after the OTP) ----------------------------------------------

interface SetupFlow {
  phoneNumber: string;
  purpose: OtpRequestPurpose;
  patientId?: string;
  dobVerified?: boolean;
  dobAttempts: number;
}

const flowKey = (token: string) => `portal:setup:${token}`;

async function saveFlow(token: string, flow: SetupFlow): Promise<void> {
  await redis.set(flowKey(token), JSON.stringify(flow), 'EX', PATIENT_SETUP_FLOW_TTL_SECONDS);
}

async function loadFlow(token: string): Promise<SetupFlow> {
  const raw = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? await redis.get(flowKey(token)) : null;
  if (!raw) throw new PatientAuthError('This step has expired. Start again with your phone number.', 401);
  return JSON.parse(raw) as SetupFlow;
}

/** "Jane W." — enough for someone to recognise themselves, without showing a stranger with a recycled number a full name. */
export function displayName(p: Pick<Patient, 'firstName' | 'lastName'>): string {
  const initial = p.lastName.trim()[0];
  return initial ? `${p.firstName} ${initial.toUpperCase()}.` : p.firstName;
}

export interface SetupPerson {
  id: string;
  displayName: string;
  hasPin: boolean;
}

/** OTP checked: starts the setup flow and returns who is on this phone (possibly nobody — then they can sign up). */
export async function startSetupFlow(rawPhone: string, purpose: OtpRequestPurpose, code: string): Promise<{ flowToken: string; people: SetupPerson[] }> {
  const phoneNumber = normalisePhone(rawPhone);
  if (!(await verifyPatientOtp(phoneNumber, purpose, code.trim()))) {
    throw new PatientAuthError('That code is wrong or has expired. Check the SMS, or ask for a new code.', 400);
  }
  const patients = await findPatientsByPhone(phoneNumber);
  const flowToken = crypto.randomBytes(32).toString('hex');
  const flow: SetupFlow = { phoneNumber, purpose, dobAttempts: 0 };
  if (patients.length === 1) flow.patientId = (patients[0] as Patient).id;
  await saveFlow(flowToken, flow);
  return { flowToken, people: patients.map((p) => ({ id: p.id, displayName: displayName(p), hasPin: Boolean(p.pinHash) })) };
}

/** Shared phone: the patient says which person they are. */
export async function selectSetupPerson(flowToken: string, patientId: string): Promise<void> {
  const flow = await loadFlow(flowToken);
  const patients = await findPatientsByPhone(flow.phoneNumber);
  if (!patients.some((p) => p.id === patientId)) throw new PatientAuthError('Choose one of the people listed', 400);
  await saveFlow(flowToken, { ...flow, patientId, dobVerified: false });
}

/**
 * Confirms the chosen patient's date of birth. When only the year is on
 * file (worked out from an age), any date in that year is accepted and
 * saved as their full date. With no date on file, the patient must ask
 * their clinic to add it first. 5 wrong tries end the flow.
 */
export async function verifySetupDateOfBirth(flowToken: string, rawDob: string): Promise<void> {
  const flow = await loadFlow(flowToken);
  if (!flow.patientId) throw new PatientAuthError('Choose who you are first', 400);
  const patient = await prisma.patient.findFirst({ where: { id: flow.patientId, phoneNumber: flow.phoneNumber, deletedAt: null } });
  if (!patient) throw new PatientAuthError('This step has expired. Start again with your phone number.', 401);
  if (!patient.dateOfBirth) {
    throw new PatientAuthError(
      "Your date of birth isn't on file yet, so we can't confirm it's you. Ask your clinic to add it, then try again.",
      409,
      { reason: 'no_dob_on_file' },
    );
  }
  const given = parseDateOfBirth(rawDob);
  const matches =
    given !== null &&
    (patient.dateOfBirthEstimated
      ? given.getUTCFullYear() === patient.dateOfBirth.getUTCFullYear()
      : formatDateOfBirth(given) === formatDateOfBirth(patient.dateOfBirth));

  if (!matches) {
    const attempts = flow.dobAttempts + 1;
    await recordAuditEvent({ actorType: 'PATIENT', actorId: patient.id, action: 'PORTAL_DOB_CHECK_FAILED', entityType: 'Patient', entityId: patient.id });
    if (attempts >= PATIENT_SETUP_MAX_DOB_ATTEMPTS) {
      await redis.del(flowKey(flowToken));
      throw new PatientAuthError('Too many wrong dates. Start again later, or ask your clinic for help.', 429);
    }
    await saveFlow(flowToken, { ...flow, dobAttempts: attempts });
    throw new PatientAuthError("That date of birth doesn't match our records.", 400);
  }

  if (patient.dateOfBirthEstimated && given) {
    await prisma.patient.update({ where: { id: patient.id }, data: { dateOfBirth: given, dateOfBirthEstimated: false } });
  }
  await saveFlow(flowToken, { ...flow, dobVerified: true });
}

/**
 * Last step: the patient sets their PIN (entered twice). Returns the
 * patient, ready for a session, and when older sessions were revoked.
 */
export async function completeSetupWithPin(flowToken: string, pin: string, pinConfirm: string): Promise<{ patient: Patient; revokedAt: number }> {
  const flow = await loadFlow(flowToken);
  if (!flow.patientId || !flow.dobVerified) throw new PatientAuthError('Confirm your date of birth first', 400);
  const patient = await prisma.patient.findFirst({ where: { id: flow.patientId, deletedAt: null } });
  if (!patient) throw new PatientAuthError('This step has expired. Start again with your phone number.', 401);
  if (pin !== pinConfirm) throw new PatientAuthError("The two PINs don't match", 400);
  const problem = pinPolicyError(pin, { phoneNumber: patient.phoneNumber, dateOfBirth: patient.dateOfBirth });
  if (problem) throw new PatientAuthError(problem, 400);

  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data: { pinHash: await bcrypt.hash(pin, env.STAFF_PIN_SALT_ROUNDS), pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await redis.del(flowKey(flowToken));
  // The old PIN (if any) may be what someone else was using: log them out everywhere.
  const revokedAt = await revokeSessionsFor(`patient:${patient.id}`);
  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patient.id,
    action: flow.purpose === 'reset' ? 'PATIENT_PIN_RESET' : 'PATIENT_PIN_SET',
    entityType: 'Patient',
    entityId: patient.id,
  });
  return { patient: updated, revokedAt };
}

export interface SelfSignupInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: Sex;
  pin: string;
  pinConfirm: string;
  email?: string;
  acceptLegal: boolean;
}

/** Portal self-signup, after the phone was confirmed by OTP. A phone may already hold other people (family). */
export async function completeSelfSignup(flowToken: string, input: SelfSignupInput): Promise<Patient> {
  const flow = await loadFlow(flowToken);
  if (flow.purpose !== 'login') throw new PatientAuthError('Start again with your phone number', 400);
  if (!input.acceptLegal) throw new PatientAuthError('Please accept the Terms of Service and Privacy Notice to create your account', 400);
  const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  if (!dateOfBirth) throw new PatientAuthError('Enter a valid date of birth', 400);
  if (input.pin !== input.pinConfirm) throw new PatientAuthError("The two PINs don't match", 400);
  const problem = pinPolicyError(input.pin, { phoneNumber: flow.phoneNumber, dateOfBirth });
  if (problem) throw new PatientAuthError(problem, 400);

  let patient: Patient;
  try {
    patient = await registerPatient({
      phoneNumberE164: flow.phoneNumber,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dateOfBirth,
      sex: input.sex,
      consentChannel: 'PORTAL',
      pin: input.pin,
      email: input.email || undefined,
      acceptedTermsAndPrivacyNotice: true,
    });
  } catch (err) {
    if (err instanceof DuplicatePatientError) throw new PatientAuthError('You already have an account on this phone. Go back and choose your name.', 409);
    throw err;
  }
  await redis.del(flowKey(flowToken));
  return patient;
}

// --- Everyday PIN login ----------------------------------------------------

function isLocked(p: Pick<Patient, 'pinLockedUntil'>, now: Date): boolean {
  return Boolean(p.pinLockedUntil && p.pinLockedUntil > now);
}

/** Minutes until the account unlocks, rounded up. */
function minutesLeft(p: Pick<Patient, 'pinLockedUntil'>, now: Date): number {
  return Math.max(1, Math.ceil(((p.pinLockedUntil as Date).getTime() - now.getTime()) / 60000));
}

/** One more wrong PIN on these accounts; the 5th locks each for 15 minutes. */
async function recordWrongPin(patients: Patient[], now: Date): Promise<void> {
  for (const p of patients) {
    // A lock that has run out starts the count again.
    const previous = p.pinLockedUntil && p.pinLockedUntil <= now ? 0 : p.pinFailedAttempts;
    const attempts = previous + 1;
    const lock = attempts >= PATIENT_PIN_MAX_ATTEMPTS;
    await prisma.patient.update({
      where: { id: p.id },
      data: {
        pinFailedAttempts: lock ? 0 : attempts,
        pinLockedUntil: lock ? new Date(now.getTime() + PATIENT_PIN_LOCK_MINUTES * 60 * 1000) : p.pinLockedUntil && p.pinLockedUntil <= now ? null : p.pinLockedUntil,
      },
    });
    await recordAuditEvent({
      actorType: 'PATIENT',
      actorId: p.id,
      action: lock ? 'PATIENT_PIN_LOCKED' : 'PATIENT_LOGIN_FAILED',
      entityType: 'Patient',
      entityId: p.id,
    });
  }
}

export type PinLoginResult =
  | { kind: 'ok'; patient: Patient }
  /** The PIN matched more than one person on a shared phone — ask which, then log in again with `patientId`. */
  | { kind: 'choose'; people: { id: string; displayName: string }[] };

const WRONG_DETAILS = 'Wrong phone number / ACISI ID or PIN. First time here, or forgot your PIN? Use the link below to get a code by SMS.';

/**
 * Phone number or ACISI ID + PIN. On a shared phone the PIN is checked
 * against each person with a PIN: one match logs them in; several ask
 * which person. A wrong PIN counts against every account it was tried on
 * (decision: shared phones count against each account), and 5 wrong lock
 * an account for 15 minutes. A locked account's PIN isn't even checked.
 */
export async function loginWithPin(identifier: string, pin: string, opts: { patientId?: string } = {}, now = new Date()): Promise<PinLoginResult> {
  const trimmed = identifier.trim();
  let candidates: Patient[];
  if (looksLikePatientCode(trimmed)) {
    const p = await findPatientByCode(trimmed.toUpperCase());
    candidates = p ? [p] : [];
  } else {
    let phone: string;
    try {
      phone = toE164(trimmed);
    } catch (err) {
      if (err instanceof InvalidPhoneNumberError) throw new PatientAuthError(WRONG_DETAILS, 401);
      throw err;
    }
    candidates = await findPatientsByPhone(phone);
  }
  if (opts.patientId) candidates = candidates.filter((p) => p.id === opts.patientId);
  candidates = candidates.filter((p) => p.pinHash);
  if (candidates.length === 0) throw new PatientAuthError(WRONG_DETAILS, 401);

  const unlocked = candidates.filter((p) => !isLocked(p, now));
  if (unlocked.length === 0) {
    const soonest = candidates.reduce((a, b) => ((a.pinLockedUntil as Date) < (b.pinLockedUntil as Date) ? a : b));
    throw new PatientAuthError(`Too many wrong PINs. Try again in ${minutesLeft(soonest, now)} minutes, or reset your PIN by SMS.`, 429, {
      reason: 'locked',
    });
  }

  const matches: Patient[] = [];
  for (const p of unlocked) {
    if (/^\d{6}$/.test(pin) && (await bcrypt.compare(pin, p.pinHash as string))) matches.push(p);
  }
  if (matches.length === 0) {
    await recordWrongPin(unlocked, now);
    throw new PatientAuthError(WRONG_DETAILS, 401);
  }
  if (matches.length > 1) {
    return { kind: 'choose', people: matches.map((p) => ({ id: p.id, displayName: displayName(p) })) };
  }
  const patient = matches[0] as Patient;
  if (patient.pinFailedAttempts > 0 || patient.pinLockedUntil) {
    await prisma.patient.update({ where: { id: patient.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
  }
  await recordAuditEvent({ actorType: 'PATIENT', actorId: patient.id, action: 'PATIENT_LOGIN_SUCCESS', entityType: 'Patient', entityId: patient.id });
  return { kind: 'ok', patient };
}

/**
 * Checks a logged-in or present patient's PIN (account deletion, approving
 * a "Request past records" at the front desk). Same lock as login.
 */
export async function confirmPatientPin(patientId: string, pin: string, now = new Date()): Promise<boolean> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null } });
  if (!patient?.pinHash) return false;
  if (isLocked(patient, now)) throw new PatientAuthError(`Too many wrong PINs. Try again in ${minutesLeft(patient, now)} minutes.`, 429);
  const ok = /^\d{6}$/.test(pin) && (await bcrypt.compare(pin, patient.pinHash));
  if (!ok) {
    await recordWrongPin([patient], now);
    return false;
  }
  if (patient.pinFailedAttempts > 0) await prisma.patient.update({ where: { id: patient.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
  return true;
}

/** The patient ticked "I have saved my ACISI ID". */
export async function markIdSaved(patientId: string): Promise<void> {
  await prisma.patient.update({ where: { id: patientId }, data: { idSavedAt: new Date() } });
  await recordAuditEvent({ actorType: 'PATIENT', actorId: patientId, action: 'PATIENT_ACISI_ID_SAVED', entityType: 'Patient', entityId: patientId });
}
