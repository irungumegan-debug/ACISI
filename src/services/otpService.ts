import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { sendPatientSms, sendSms } from './smsService';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { Patient, Staff } from '@prisma/client';

/** The code could not be sent by SMS (Africa's Talking down or the number rejected). */
export class SmsNotSentError extends Error {
  constructor() {
    super('The code could not be sent by SMS');
    this.name = 'SmsNotSentError';
  }
}

/**
 * Generates a PIN-reset OTP, stores its hash, and sends it by SMS. This is
 * reset-only — never used for everyday patient login, per the identity
 * model (see docs/ARCHITECTURE.md and prisma/schema.prisma's Otp model).
 */
export async function requestPinResetOtp(patient: Patient): Promise<void> {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);

  await prisma.otp.create({
    data: {
      patientId: patient.id,
      purpose: 'PIN_RESET',
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    },
  });

  // Essential: goes even to patients who don't want clinic SMS.
  const outcome = await sendPatientSms(
    patient,
    `Your ACISI PIN reset code is ${code}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
    { purpose: 'PIN_RESET_CODE', essential: true },
  );
  if (outcome !== 'sent') {
    logger.error({ patientId: patient.id, outcome }, 'Failed to send PIN reset OTP SMS');
    throw new SmsNotSentError();
  }

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patient.id,
    action: 'PIN_RESET_OTP_REQUESTED',
    entityType: 'Patient',
    entityId: patient.id,
  });
}

/**
 * Verifies a submitted OTP against the most recent unconsumed, unexpired
 * PIN_RESET code for this patient. Returns whether it matched; on a match
 * the code is marked consumed so it can't be replayed.
 */
export async function verifyPinResetOtp(patientId: string, code: string): Promise<'SMS_CODE' | 'IN_PERSON_CODE' | null> {
  // Either the SMS code, or a setup code front desk showed after ringing the
  // patient's phone in front of them (issueInPersonSetupCode).
  const otp = await prisma.otp.findFirst({
    where: { patientId, purpose: { in: ['PIN_RESET', 'IN_PERSON_SETUP'] }, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp || otp.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return null;
  }

  const isValid = await bcrypt.compare(code, otp.codeHash);

  if (isValid) {
    await prisma.otp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  } else {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  }

  return isValid ? (otp.purpose === 'IN_PERSON_SETUP' ? 'IN_PERSON_CODE' : 'SMS_CODE') : null;
}

/**
 * C3 fallback when SMS can't be sent: front desk rang the patient's phone in
 * front of them (so they hold it) and now shows this one-time code on the
 * staff screen. The patient types it on the portal's "Set or reset PIN" page
 * to choose their PIN. Never sent by SMS. Same rules as an SMS code: hashed,
 * 10 minutes, single use, limited tries.
 */
export async function issueInPersonSetupCode(patientId: string, staffId: string, clinicId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
  await prisma.otp.create({ data: { patientId, purpose: 'IN_PERSON_SETUP', codeHash: await bcrypt.hash(code, 10), expiresAt } });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'PATIENT_PHONE_VERIFIED_IN_PERSON',
    entityType: 'Patient',
    entityId: patientId,
    metadata: { flow: 'PORTAL_SETUP_CODE' },
  });
  return { code, expiresAt };
}

/**
 * Staff/doctor counterpart of requestPinResetOtp: texts a one-time code to
 * the staff member's registered phone so they can reset a forgotten PIN
 * themselves, without needing their clinic admin.
 */
export async function requestStaffPinResetOtp(staff: Staff): Promise<void> {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);

  await prisma.staffOtp.create({
    data: {
      staffId: staff.id,
      purpose: 'PIN_RESET',
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    },
  });

  const outcome = await sendSms(
    staff.phoneNumber,
    `Your ACISI staff PIN reset code is ${code}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
    'STAFF_PIN_RESET_CODE',
  );
  if (outcome !== 'sent') {
    logger.error({ staffId: staff.id }, 'Failed to send staff PIN reset OTP SMS');
    throw new SmsNotSentError();
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staff.id,
    staffId: staff.id,
    action: 'STAFF_PIN_RESET_OTP_REQUESTED',
    entityType: 'Staff',
    entityId: staff.id,
  });
}

/** Staff/doctor counterpart of verifyPinResetOtp — same single-use, limited-guess rules. */
export async function verifyStaffPinResetOtp(staffId: string, code: string): Promise<boolean> {
  const otp = await prisma.staffOtp.findFirst({
    where: { staffId, purpose: 'PIN_RESET', consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp || otp.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return false;
  }

  const isValid = await bcrypt.compare(code, otp.codeHash);

  if (isValid) {
    await prisma.staffOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  } else {
    await prisma.staffOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  }

  return isValid;
}
