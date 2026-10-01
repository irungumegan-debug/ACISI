/**
 * The one rule for every PIN someone chooses — patients, staff, doctors and
 * clinic admins alike. PINs stay numeric (staff also log in over USSD, where
 * the keypad reliably sends only digits), so strength comes from length
 * plus refusing the PINs people actually pick: dates (birthdays above all),
 * repeated or sequential digits, and their own phone number. Combined with
 * the login lockout (5 tries per 15 minutes), that leaves blind guessing
 * hopeless.
 *
 * Only applied when a PIN is *set* — login and confirmation checks just
 * compare against the stored hash, so they never reject an existing PIN.
 */

export const PIN_LENGTH = 6;

export interface PinContext {
  /** The account's phone number, in any format — its last six digits are refused. */
  phoneNumber?: string | null;
}

function daysInMonth(month: number, twoOrFourDigitYear?: number): number {
  if (month === 2) {
    // Unknown century for two-digit years: accept Feb 29 if it could be a leap year.
    return twoOrFourDigitYear === undefined || twoOrFourDigitYear % 4 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isDay(day: number, month: number, year?: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year);
}

/** True for any six digits that read as a calendar date in a common layout. */
export function looksLikeDate(pin: string): boolean {
  const n = (from: number, len: number) => Number(pin.slice(from, from + len));
  const [a, b, c] = [n(0, 2), n(2, 2), n(4, 2)];
  return (
    isDay(a, b, c) || // DDMMYY  — 150390
    isDay(b, a, c) || // MMDDYY  — 031590
    isDay(c, b, a) || // YYMMDD  — 900315
    (a >= 1 && a <= 12 && n(2, 4) >= 1900 && n(2, 4) <= 2099) || // MMYYYY — 031990
    (n(0, 4) >= 1900 && n(0, 4) <= 2099 && c >= 1 && c <= 12) // YYYYMM — 199003
  );
}

/** 111111, 121212, 123123 — a short block repeated. */
function isRepeating(pin: string): boolean {
  return /^(\d)\1{5}$/.test(pin) || /^(\d\d)\1{2}$/.test(pin) || /^(\d{3})\1$/.test(pin);
}

/** 123456, 654321, 890123 — every step up by one, or every step down by one. */
function isSequential(pin: string): boolean {
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i++) {
    steps.add((Number(pin[i]) - Number(pin[i - 1]) + 10) % 10);
  }
  return steps.size === 1 && (steps.has(1) || steps.has(9));
}

/** Returns why `pin` can't be used, or null if it's fine. */
export function pinPolicyError(pin: string, context: PinContext = {}): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    return `Your PIN must be exactly ${PIN_LENGTH} digits.`;
  }
  if (isRepeating(pin) || isSequential(pin)) {
    return 'That PIN is too easy to guess. Avoid repeated or sequential digits like 111111 or 123456.';
  }
  if (looksLikeDate(pin)) {
    return 'That PIN looks like a date, which is easy to guess. Avoid birthdays and other dates.';
  }
  const phoneDigits = context.phoneNumber?.replace(/\D/g, '') ?? '';
  if (phoneDigits.length >= PIN_LENGTH && phoneDigits.endsWith(pin)) {
    return "That PIN is part of your phone number, which is easy to guess. Choose something else.";
  }
  return null;
}
