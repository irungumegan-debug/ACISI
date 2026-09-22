/**
 * Bump CONSENT_VERSION whenever CONSENT_PROMPT_TEXT or
 * CROSS_CLINIC_CONSENT_PROMPT_TEXT changes meaningfully. Consent rows store
 * the version that was shown, so we can always reproduce exactly what a
 * patient agreed to — required for Data Protection Act accountability, not
 * just nice-to-have.
 */
export const CONSENT_VERSION = 'v2';

/** Required to register at all — creating a basic record at this clinic. */
export const CONSENT_PROMPT_TEXT =
  'ACISI will create a basic health record for you (name, visits) so this clinic can serve you now and on ' +
  'future visits. Agree?';

/** Optional, defaults to declined — separate from CONSENT_PROMPT_TEXT above. */
export const CROSS_CLINIC_CONSENT_PROMPT_TEXT =
  'Should other ACISI-connected clinics be able to see this record too, so any clinic you visit has your ' +
  'history? You can still check in elsewhere either way.';

export const MAX_STAFF_PIN_ATTEMPTS = 3;

export const HISTORY_ENCOUNTER_LIMIT = 5;

/** Clinics shown per page in the USSD check-in clinic-selection menu. */
export const CLINICS_PER_PAGE = 5;

/** Staff dashboard web session lifetime — roughly a shift. */
export const DASHBOARD_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Brute-force guard on the dashboard PIN login endpoint. */
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

/** Patient PIN-reset OTP: how long a code is valid, and how many guesses it tolerates. */
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Guards against SMS-bombing a phone number with repeated OTP requests. */
export const OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;
export const OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
