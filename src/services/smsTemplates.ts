/**
 * Patient-facing SMS copy that has to fit a single SMS. Kept here, in one
 * place, so wording changes (and the planned USSD line, see below) only
 * ever touch this file.
 */

/** One GSM-7 SMS. Going over splits the message into two (and doubles the cost). */
export const SINGLE_SMS_MAX_CHARS = 160;

/** Where a patient checks in from home: the portal opens on its "Check in" tab (after login). */
export const PATIENT_CHECKIN_URL = 'acisi.co.ke/patient';

/** Added to receipts and visit summaries, but only when it costs no extra SMS part (see appendIfNoExtraPart). */
export const PRIVACY_NOTICE_SMS_LINE = 'Privacy: acisi.co.ke/privacy';

// GSM 03.38: the basic alphabet (1 character each) and its extension table
// (2 each: an escape plus the character). Anything else forces UCS-2.
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM7_EXTENDED = new Set('^{}\\[~]|€\f');

/**
 * How many SMS parts a message is billed as. GSM-7: 160 characters in one
 * SMS, 153 per part once split. If any character is outside GSM-7 the whole
 * message goes as UCS-2: 70 in one SMS, 67 per part.
 */
export function smsPartCount(message: string): number {
  let gsmLength = 0;
  let isGsm7 = true;
  for (const ch of message) {
    if (GSM7_BASIC.has(ch)) gsmLength += 1;
    else if (GSM7_EXTENDED.has(ch)) gsmLength += 2;
    else {
      isGsm7 = false;
      break;
    }
  }
  if (isGsm7) return gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  const ucs2Length = message.length; // UTF-16 code units, as UCS-2 counts them
  return ucs2Length <= 70 ? 1 : Math.ceil(ucs2Length / 67);
}

/** `message + separator + extra` if that is still the same number of SMS parts as `message`; otherwise `message` unchanged. */
export function appendIfNoExtraPart(message: string, separator: string, extra: string): string {
  const longer = `${message}${separator}${extra}`;
  return smsPartCount(longer) === smsPartCount(message) ? longer : message;
}

/**
 * Restricts text to plain printable ASCII (a safe subset of the GSM-7
 * alphabet). A single character outside GSM-7 — a curly apostrophe in a
 * clinic name, an emoji — silently switches the whole SMS to UCS-2, where
 * the limit drops from 160 to 70 characters.
 */
export function toSmsSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The one-off invite sent to a walk-in patient who agreed to SMS from the
 * clinic: "Welcome to [Clinic]. Next time, skip the queue: check in from
 * home at acisi.co.ke/patient". Always a single SMS — if the clinic name
 * would push it past 160 characters, the clinic name is shortened rather
 * than the message being split in two.
 *
 * TODO: Add USSD code to invite once live shortcode is active (planned Dec
 * 2026 / early 2027; see "Planned features" in CLAUDE.md). The USSD code is
 * already available as env.AT_USSD_SERVICE_CODE — add it as e.g.
 * "... at acisi.co.ke/patient or dial *384*123#", and keep the clinic-name
 * shortening below so the total still fits one SMS.
 */
export function buildWalkInInviteSms(clinicName: string): string {
  const before = 'Welcome to ';
  const after = `. Next time, skip the queue: check in from home at ${PATIENT_CHECKIN_URL}`;
  const room = SINGLE_SMS_MAX_CHARS - before.length - after.length;

  let name = toSmsSafe(clinicName) || 'the clinic';
  if (name.length > room) {
    name = name.slice(0, room - 3).trimEnd() + '...';
  }
  return `${before}${name}${after}`;
}

/** 1500 -> "1,500" (integer KES only — no floating point anywhere in money). */
export function formatKes(amountKes: number): string {
  return String(Math.trunc(amountKes)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One payment as it appears on an SMS receipt. */
export interface ReceiptPaymentLine {
  method: 'CASH' | 'CARD' | 'MPESA_STK' | 'MPESA_MANUAL';
  /** M-Pesa code or card reference, if any. */
  reference: string | null;
}

function describePayment(p: ReceiptPaymentLine): string {
  const ref = p.reference ? ` ${toSmsSafe(p.reference)}` : '';
  if (p.method === 'CASH') return 'Cash';
  if (p.method === 'CARD') return `Card${ref}`;
  return `M-Pesa${ref}`;
}

/**
 * The paid receipt SMS, sent once when a bill is fully paid:
 * "Sunrise Family Clinic: Received KES 1,500 on 03/10/2026 via M-Pesa
 * QAB12CD34E, Cash. Thank you. Privacy: acisi.co.ke/privacy" Always one
 * SMS — the payment list and then the clinic name are shortened if needed,
 * never split into two messages. The privacy line is added only when it
 * still fits; nothing else is ever shortened to make room for it.
 */
export function buildPaymentReceiptSms(input: {
  clinicName: string;
  totalPaidKes: number;
  /** Already formatted DD/MM/YYYY. */
  date: string;
  payments: ReceiptPaymentLine[];
}): string {
  const methods = [...new Set(input.payments.map(describePayment))];
  const build = (name: string, methodText: string) =>
    `${name}: Received KES ${formatKes(input.totalPaidKes)} on ${input.date} via ${methodText}. Thank you.`;

  let methodText = methods.join(', ');
  let name = toSmsSafe(input.clinicName) || 'Clinic';

  if (build(name, methodText).length > SINGLE_SMS_MAX_CHARS) {
    // Too many references to fit: keep the method names, drop the codes.
    methodText = [...new Set(input.payments.map((p) => describePayment({ ...p, reference: null })))].join(', ');
  }
  const overflow = build(name, methodText).length - SINGLE_SMS_MAX_CHARS;
  if (overflow > 0) {
    name = name.slice(0, Math.max(name.length - overflow - 3, 8)).trimEnd() + '...';
  }
  // Only when there's room left: never shortens anything else to make space.
  return appendIfNoExtraPart(build(name, methodText), ' ', PRIVACY_NOTICE_SMS_LINE);
}

const KENYA_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Appointment reminder, sent the day before for confirmed appointments:
 * "ACISI: Reminder of your appointment at Sunrise Family Clinic on Fri 31
 * Oct at 10:00." Clinic, day and time only: no department, no reason, no
 * health details. Always one SMS (the clinic name is shortened if needed).
 */
export function buildAppointmentReminderSms(input: { clinicName: string; scheduledFor: Date }): string {
  const k = new Date(input.scheduledFor.getTime() + KENYA_OFFSET_MS);
  const when = `${WEEKDAYS[k.getUTCDay()]} ${k.getUTCDate()} ${MONTHS[k.getUTCMonth()]} at ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  const before = 'ACISI: Reminder of your appointment at ';
  const after = ` on ${when}.`;
  const room = SINGLE_SMS_MAX_CHARS - before.length - after.length;
  let name = toSmsSafe(input.clinicName) || 'the clinic';
  if (name.length > room) name = name.slice(0, room - 3).trimEnd() + '...';
  return `${before}${name}${after}`;
}

/** Clinic name made SMS-safe and shortened so `before + name + after` fits one SMS. */
function fitClinicName(clinicName: string, fixedLength: number): string {
  const room = SINGLE_SMS_MAX_CHARS - fixedLength;
  const name = toSmsSafe(clinicName) || 'the clinic';
  return name.length > room ? name.slice(0, room - 3).trimEnd() + '...' : name;
}

/**
 * The ACISI check-in fee SMS: two short lines, always one SMS.
 * Paid:   "ACISI: Check-in confirmed at Sunrise Family Clinic.\nPayment confirmed: KES 100."
 * Failed: "ACISI: Check-in at Sunrise Family Clinic: payment not received.\nPay from your ACISI profile."
 */
export function buildCheckInFeeSms(input: { clinicName: string; amountKes: number; paid: boolean }): string {
  if (input.paid) {
    const before = 'ACISI: Check-in confirmed at ';
    const after = `.\nPayment confirmed: KES ${formatKes(input.amountKes)}.`;
    return `${before}${fitClinicName(input.clinicName, before.length + after.length)}${after}`;
  }
  const before = 'ACISI: Check-in at ';
  const after = ': payment not received.\nPay from your ACISI profile.';
  return `${before}${fitClinicName(input.clinicName, before.length + after.length)}${after}`;
}
