import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { smsClient } from '../config/africastalking';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { Patient } from '@prisma/client';

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

  try {
    await smsClient.send({
      to: [patient.phoneNumber],
      message: `Your ACISI PIN reset code is ${code}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
    });
  } catch (err) {
    logger.error({ err, patientId: patient.id }, 'Failed to send PIN reset OTP SMS');
    throw err;
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
export async function verifyPinResetOtp(patientId: string, code: string): Promise<boolean> {
  const otp = await prisma.otp.findFirst({
    where: { patientId, purpose: 'PIN_RESET', consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp || otp.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return false;
  }

  const isValid = await bcrypt.compare(code, otp.codeHash);

  if (isValid) {
    await prisma.otp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  } else {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  }

  return isValid;
}
