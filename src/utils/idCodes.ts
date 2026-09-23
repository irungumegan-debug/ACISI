import crypto from 'node:crypto';

/**
 * Excludes visually-ambiguous characters (0/O, 1/I/L) so codes are easy to
 * read back over a phone call or copy from a screen without transcription
 * errors.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  }
  return out;
}

/** e.g. "ACI-7F2K" */
export function generatePatientCode(): string {
  return `ACI-${randomCode(4)}`;
}

/** e.g. "ACI-STF-7F2K" */
export function generateStaffCode(): string {
  return `ACI-STF-${randomCode(4)}`;
}

/** e.g. "SUNRISE-7F2K", derived from the clinic name with a random suffix for uniqueness. */
export function generateClinicInviteCode(clinicName: string): string {
  const slug =
    clinicName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12) || 'CLINIC';
  return `${slug}-${randomCode(4)}`;
}

/** Six-digit numeric OTP, sent by SMS. */
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Six-digit numeric temporary PIN — for an admin-initiated PIN reset, not an OTP (this one becomes the new login credential, not a single-use code). */
export function generateTemporaryPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Three-digit USSD clinic-selection code, e.g. "482". */
export function generateUssdCode(): string {
  return String(crypto.randomInt(100, 1000));
}
