import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { smsClient } from '../config/africastalking';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS } from '../config/constants';
import { generateOtpCode } from '../utils/idCodes';
import { Staff } from '@prisma/client';

/**
 * Staff/doctor PIN reset: texts a one-time code to
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

  try {
    await smsClient.send({
      to: [staff.phoneNumber],
      message: `Your ACISI staff PIN reset code is ${code}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
    });
  } catch (err) {
    logger.error({ err, staffId: staff.id }, 'Failed to send staff PIN reset OTP SMS');
    throw err;
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

/** Checks a staff PIN-reset code: single use, limited guesses. (Patients use patientAuthService.) */
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
