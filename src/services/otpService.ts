import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { sendPatientSms } from './smsService';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { Patient } from '@prisma/client';

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
  // The newest code of EACH kind is checked: pressing "Forgot PIN" after the
  // front desk gave a setup code makes a newer SMS code, and that must not
  // hide the setup code the patient is holding (SMS may never arrive).
  const now = new Date();
  const candidates = (
    await Promise.all(
      (['IN_PERSON_SETUP', 'PIN_RESET'] as const).map((purpose) =>
        prisma.otp.findFirst({ where: { patientId, purpose, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } }),
      ),
    )
  ).filter((o): o is NonNullable<typeof o> => o !== null && o.attempts < OTP_MAX_VERIFY_ATTEMPTS);

  for (const otp of candidates) {
    if (await bcrypt.compare(code, otp.codeHash)) {
      await prisma.otp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      return otp.purpose === 'IN_PERSON_SETUP' ? 'IN_PERSON_CODE' : 'SMS_CODE';
    }
  }
  // A wrong guess counts against every live code, so two codes don't double the tries.
  for (const otp of candidates) await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  return null;
}

/**
 * C3 fallback when SMS can't be sent: front desk rang the patient's phone in
 * front of them (so they hold it) and now shows this one-time code on the
 * staff screen. The patient types it on the portal's "Set or reset PIN" page
 * to choose their PIN. Never sent by SMS. Same rules as an SMS code: hashed,
 * 10 minutes, single use, limited tries.
 */
/** Creates (but doesn't log) an in-person setup code; callers write their own audit row. */
export async function createInPersonSetupCode(patientId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
  await prisma.otp.create({ data: { patientId, purpose: 'IN_PERSON_SETUP', codeHash: await bcrypt.hash(code, 10), expiresAt } });
  return { code, expiresAt };
}

export async function issueInPersonSetupCode(patientId: string, staffId: string, clinicId: string): Promise<{ code: string; expiresAt: Date }> {
  const { code, expiresAt } = await createInPersonSetupCode(patientId);
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
