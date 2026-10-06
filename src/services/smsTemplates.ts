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

/**
 * The visit summary SMS sent at front-desk checkout: clinic name, visit
 * date, and the prescription (medicines and how to take them) — nothing
 * else. The diagnosis and the department are deliberately left out: our
 * privacy notice promises the diagnosis never goes out by SMS, and a
 * department name (e.g. "Gynecology") can reveal much the same thing.
 *
 * The prescription is sent as the doctor wrote it — not passed through
 * toSmsSafe, which would strip characters like "µ" from a dose — and is
 * never shortened, since a cut-off dosage is worse than a two-part SMS.
 * A final "Privacy: acisi.co.ke/privacy" line is added only when it doesn't
 * push the message into an extra SMS part.
 */
export function buildVisitSummarySms(input: {
  clinicName: string;
  /** Already formatted DD/MM/YYYY. */
  date: string;
  prescription: string | null;
}): string {
  const clinic = toSmsSafe(input.clinicName) || 'Clinic';
  const medicines = input.prescription?.trim() || 'None';
  const summary = `${clinic}\nVisit: ${input.date}\nMedicines: ${medicines}\nThank you for visiting.`;
  return appendIfNoExtraPart(summary, '\n', PRIVACY_NOTICE_SMS_LINE);
}
