import crypto from 'node:crypto';
import { PATIENT_OTP_LENGTH } from '../config/constants';

/** Generates a zero-padded numeric OTP, e.g. "042817" for length 6. */
export function generateOtpCode(): string {
  const max = 10 ** PATIENT_OTP_LENGTH;
  const value = crypto.randomInt(0, max);
  return value.toString().padStart(PATIENT_OTP_LENGTH, '0');
}

/** SHA-256 of the code — never store or log the raw OTP. */
export function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
