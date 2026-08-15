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

/** Converts an E.164 number to Daraja's expected format, e.g. "254712345678". */
export function toDarajaFormat(e164: string): string {
  return e164.replace(/^\+/, '');
}
