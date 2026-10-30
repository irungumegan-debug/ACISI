import bcrypt from 'bcrypt';
import { PendingPatientSignup, Patient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis } from '../config/redis';
import {
  ONE_TIME_CODE_MAX_ATTEMPTS,
  ONE_TIME_CODE_TTL_SECONDS,
  OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS,
  OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
  PENDING_SIGNUP_KEEP_DAYS,
} from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { findPatientByPhone, registerPatient } from './patientService';
import { sendSms } from './smsService';
import { recordAuditEvent } from './auditService';
import type { PatientIdentityUpdate } from './patientIdentity';

/**
 * Phone verification at portal signup (C3). The signup is kept as a
 * PendingPatientSignup until the patient proves they hold the phone:
 *
 * - by the SMS code (verifyPendingSignup), or
 * - at the clinic, when SMS can't be sent: front desk finds the pending
 *   signup by phone number, rings the number in front of the patient and
 *   taps "Finish setup" (completePendingSignupInPerson).
 *
 * Only then does a Patient exist, so nobody can claim someone else's number.
 * Nothing has to be retyped: everything the patient entered (including the
 * hashed PIN) is kept for PENDING_SIGNUP_KEEP_DAYS, then deleted.
 */

export class PendingSignupError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 429 = 400,
  ) {
    super(message);
    this.name = 'PendingSignupError';
  }
}

export interface PendingSignupInput {
  phoneNumberE164: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  sex: PendingPatientSignup['sex'];
  email?: string;
  identity: PatientIdentityUpdate;
  pinHash: string;
  crossClinicConsent: boolean;
}

const keepUntil = (now: Date) => new Date(now.getTime() + PENDING_SIGNUP_KEEP_DAYS * 24 * 60 * 60 * 1000);

async function newCode(): Promise<{ code: string; codeHash: string }> {
  const code = generateOtpCode();
  return { code, codeHash: await bcrypt.hash(code, 10) };
}

async function sendSignupCode(phoneNumber: string, code: string): Promise<boolean> {
  const minutes = Math.round(ONE_TIME_CODE_TTL_SECONDS / 60);
  const outcome = await sendSms(
    phoneNumber,
    `Your ACISI code is ${code}. Enter it to finish creating your account. It expires in ${minutes} minutes. Do not share it.`,
    'SIGNUP_PHONE_CODE',
  );
  return outcome === 'sent';
}

/**
 * Saves the signup and texts a code. Returns smsSent=false when the code
 * could not be sent; the signup is kept either way, ready for the clinic.
 * A new signup for the same number replaces an earlier pending one.
 */
export async function startPendingSignup(input: PendingSignupInput): Promise<{ pendingId: string; smsSent: boolean }> {
  if (await findPatientByPhone(input.phoneNumberE164)) {
    throw new PendingSignupError('An account with that phone number already exists', 409);
  }
  const now = new Date();
  const { code, codeHash } = await newCode();
  const pending = await prisma.$transaction(async (tx) => {
    await tx.pendingPatientSignup.deleteMany({ where: { phoneNumber: input.phoneNumberE164 } });
    return tx.pendingPatientSignup.create({
      data: {
        phoneNumber: input.phoneNumberE164,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        sex: input.sex,
        email: input.email,
        idType: input.identity.idType ?? null,
        idNumber: input.identity.idNumber ?? null,
        nextOfKinName: input.identity.nextOfKinName ?? null,
        nextOfKinPhone: input.identity.nextOfKinPhone ?? null,
        pinHash: input.pinHash,
        crossClinicConsent: input.crossClinicConsent,
        codeHash,
        codeExpiresAt: new Date(now.getTime() + ONE_TIME_CODE_TTL_SECONDS * 1000),
        expiresAt: keepUntil(now),
      },
    });
  });
  return { pendingId: pending.id, smsSent: await sendSignupCode(pending.phoneNumber, code) };
}

/** "Send the code again": a fresh code, at most OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS per window. */
export async function resendSignupCode(pendingId: string): Promise<{ smsSent: boolean }> {
  const pending = await prisma.pendingPatientSignup.findFirst({ where: { id: pendingId, expiresAt: { gt: new Date() } } });
  if (!pending) throw new PendingSignupError('This signup has expired. Please sign up again.', 404);

  const key = `signup:code_requests:${pending.id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS);
  if (count > OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS) throw new PendingSignupError('Too many codes requested. Try again in a few minutes.', 429);

  const { code, codeHash } = await newCode();
  await prisma.pendingPatientSignup.update({
    where: { id: pending.id },
    data: { codeHash, codeExpiresAt: new Date(Date.now() + ONE_TIME_CODE_TTL_SECONDS * 1000), codeAttempts: 0 },
  });
  return { smsSent: await sendSignupCode(pending.phoneNumber, code) };
}

/** Turns a verified pending signup into a real patient account and deletes the pending row. */
async function createPatientFrom(pending: PendingPatientSignup, via: 'SMS' | 'IN_PERSON'): Promise<Patient> {
  if (await findPatientByPhone(pending.phoneNumber)) {
    await prisma.pendingPatientSignup.delete({ where: { id: pending.id } }).catch(() => undefined);
    throw new PendingSignupError('An account with that phone number already exists', 409);
  }
  const patient = await registerPatient({
    phoneNumberE164: pending.phoneNumber,
    firstName: pending.firstName,
    lastName: pending.lastName,
    dateOfBirth: pending.dateOfBirth ?? undefined,
    sex: pending.sex,
    email: pending.email ?? undefined,
    identity: {
      idType: pending.idType,
      idNumber: pending.idNumber,
      nextOfKinName: pending.nextOfKinName,
      nextOfKinPhone: pending.nextOfKinPhone,
    },
    pinHash: pending.pinHash,
    consentChannel: 'PORTAL',
    crossClinicConsent: pending.crossClinicConsent,
    acceptedTermsAndPrivacyNotice: true,
    phoneVerifiedVia: via,
  });
  await prisma.pendingPatientSignup.delete({ where: { id: pending.id } }).catch(() => undefined);
  return patient;
}

/** The patient typing the SMS code. Wrong codes are counted; after ONE_TIME_CODE_MAX_ATTEMPTS the code stops working. */
export async function verifyPendingSignup(pendingId: string, code: string): Promise<Patient> {
  const now = new Date();
  const pending = await prisma.pendingPatientSignup.findFirst({ where: { id: pendingId, expiresAt: { gt: now } } });
  if (!pending) throw new PendingSignupError('This signup has expired. Please sign up again.', 404);

  const usable = !!pending.codeHash && !!pending.codeExpiresAt && pending.codeExpiresAt > now && pending.codeAttempts < ONE_TIME_CODE_MAX_ATTEMPTS;
  if (!usable) throw new PendingSignupError('This code has expired. Ask for a new code.', 400);
  if (!(await bcrypt.compare(code.trim(), pending.codeHash!))) {
    await prisma.pendingPatientSignup.update({ where: { id: pending.id }, data: { codeAttempts: { increment: 1 } } });
    throw new PendingSignupError('That code is not right. Check the SMS and try again.', 400);
  }
  return createPatientFrom(pending, 'SMS');
}

/** Front desk: pending signups for a phone number, name only (to confirm it's the right person). */
export async function findPendingSignupsByPhone(phoneNumberE164: string, staffId: string, clinicId: string) {
  const rows = await prisma.pendingPatientSignup.findMany({
    where: { phoneNumber: phoneNumberE164, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, firstName: true, lastName: true, createdAt: true },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'PENDING_SIGNUP_LOOKED_UP',
    entityType: 'PendingPatientSignup',
    metadata: { found: rows.length },
  });
  return rows.map((r) => ({ pendingId: r.id, name: `${r.firstName} ${r.lastName}`, signedUpAt: r.createdAt }));
}

/**
 * Front desk "Finish setup", after ringing the patient's number in front of
 * them (the phone rang: they hold it). Creates the account with the PIN the
 * patient chose at signup; they log in with it straight away.
 */
export async function completePendingSignupInPerson(pendingId: string, staffId: string, clinicId: string): Promise<Patient> {
  const pending = await prisma.pendingPatientSignup.findFirst({ where: { id: pendingId, expiresAt: { gt: new Date() } } });
  if (!pending) throw new PendingSignupError('This signup has expired. The patient can sign up again.', 404);
  const patient = await createPatientFrom(pending, 'IN_PERSON');
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'PATIENT_PHONE_VERIFIED_IN_PERSON',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { flow: 'PENDING_SIGNUP' },
  });
  return patient;
}

/** Hourly housekeeping: pending signups past PENDING_SIGNUP_KEEP_DAYS are deleted. */
export async function deleteExpiredPendingSignups(now: Date = new Date()): Promise<{ deleted: number }> {
  const { count } = await prisma.pendingPatientSignup.deleteMany({ where: { expiresAt: { lte: now } } });
  return { deleted: count };
}
