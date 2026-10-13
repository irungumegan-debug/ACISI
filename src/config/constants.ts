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

/**
 * Owner site session lifetime — deliberately much shorter than a staff
 * shift, since an owner session can read and delete every record on the
 * platform.
 */
export const OWNER_SESSION_TTL_SECONDS = 2 * 60 * 60;

/** Minimum length for the owner's password (set via scripts/createOwner.ts). */
export const OWNER_PASSWORD_MIN_LENGTH = 12;

/** Brute-force guard on the dashboard PIN login endpoint. */
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

/** Staff PIN-reset OTP: how long a code is valid. (Patients use PATIENT_OTP_TTL_SECONDS.) */
export const OTP_TTL_SECONDS = 10 * 60;
/** How many guesses an OTP tolerates before it's dead (staff and patients). */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/**
 * Patient portal OTP (first login and forgot PIN — the only two times a
 * patient is ever sent one): 6 digits, 5 minutes, single use, at most 3 per
 * phone number per hour (counted in the database).
 */
export const PATIENT_OTP_TTL_SECONDS = 5 * 60;
export const PATIENT_OTP_MAX_SENDS_PER_HOUR = 3;
/** Per-IP cap on OTP sends across all numbers, so nobody can run up our SMS bill. */
export const PATIENT_OTP_MAX_SENDS_PER_IP_PER_HOUR = 10;
/** After the OTP: how long the patient has to pick who they are, confirm their date of birth and set a PIN. */
export const PATIENT_SETUP_FLOW_TTL_SECONDS = 15 * 60;
export const PATIENT_SETUP_MAX_DOB_ATTEMPTS = 5;

/** Patient PIN lock: this many wrong PINs locks the account for PATIENT_PIN_LOCK_MINUTES. */
export const PATIENT_PIN_MAX_ATTEMPTS = 5;
export const PATIENT_PIN_LOCK_MINUTES = 15;

/** "Keep me signed in" on a personal device: the portal session lasts this long instead of 8 hours. */
export const PATIENT_LONG_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Guards against SMS-bombing a staff phone number with repeated OTP requests. */
export const OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;
export const OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
