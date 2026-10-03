/**
 * Patient-facing SMS copy that has to fit a single SMS. Kept here, in one
 * place, so wording changes (and the planned USSD line, see below) only
 * ever touch this file.
 */

/** One GSM-7 SMS. Going over splits the message into two (and doubles the cost). */
export const SINGLE_SMS_MAX_CHARS = 160;

/** Where a patient checks in from home: the portal opens on its "Check in" tab (after login). */
export const PATIENT_CHECKIN_URL = 'acisi.co.ke/patient';

/**
 * Restricts text to plain printable ASCII (a safe subset of the GSM-7
 * alphabet). A single character outside GSM-7 — a curly apostrophe in a
 * clinic name, an emoji — silently switches the whole SMS to UCS-2, where
 * the limit drops from 160 to 70 characters.
 */
function toSmsSafe(text: string): string {
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
