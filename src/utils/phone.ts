/**
 * Kenyan phone number helpers. Africa's Talking sends numbers as "+2547XXXXXXXX";
 * Daraja expects "2547XXXXXXXX" (no leading "+"); patients may type "07XXXXXXXX"
 * or "01XXXXXXXX" locally-formatted numbers when prompted. Normalize everything
 * to E.164 ("+2547XXXXXXXX") for storage and lookup, and derive Daraja's format
 * from that at the point of use.
 */

const KENYA_COUNTRY_CODE = '254';

export class InvalidPhoneNumberError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid Kenyan phone number`);
    this.name = 'InvalidPhoneNumberError';
  }
}

/** Normalizes a Kenyan phone number to E.164, e.g. "+254712345678". */
export function toE164(rawInput: string): string {
  const digitsOnly = rawInput.replace(/[^\d]/g, '');

  let localDigits: string;
  if (digitsOnly.startsWith(KENYA_COUNTRY_CODE)) {
    localDigits = digitsOnly.slice(KENYA_COUNTRY_CODE.length);
  } else if (digitsOnly.startsWith('0')) {
    localDigits = digitsOnly.slice(1);
  } else {
    localDigits = digitsOnly;
  }

  const isValidSubscriberNumber = /^[17]\d{8}$/.test(localDigits);
  if (!isValidSubscriberNumber) {
    throw new InvalidPhoneNumberError(rawInput);
  }

  return `+${KENYA_COUNTRY_CODE}${localDigits}`;
}

/**
 * Safaricom's number ranges (Communications Authority of Kenya allocation):
 * 0700-0729, 0740-0743, 0745, 0746, 0748, 0757-0759, 0768, 0769,
 * 0790-0799 and 0110-0115. Based on the prefix only, so a number ported in
 * from Airtel or Telkom (rare) is not recognised.
 */
const SAFARICOM_PREFIX = /^(?:7(?:[0-2]\d|4[0-35-68]|5[7-9]|6[89]|9\d)|11[0-5])/;

/** Whether a Kenyan number (any format toE164 accepts) is on Safaricom. False for anything invalid. */
export function isSafaricomNumber(rawInput: string): boolean {
  try {
    return SAFARICOM_PREFIX.test(toE164(rawInput).slice(1 + KENYA_COUNTRY_CODE.length));
  } catch {
    return false;
  }
}

/** For logs: "+254712345678" -> "2547******78". Never the full number. */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(digits.length - 6)}${digits.slice(-2)}`;
}

/** Converts an E.164 number to Daraja's expected format, e.g. "254712345678". */
export function toDarajaFormat(e164: string): string {
  return e164.replace(/^\+/, '');
}
