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

/** Staff dashboard web session lifetime — roughly a shift. Also the patient portal's. */
export const DASHBOARD_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Clinic admins (role ADMIN) see payments, staff and settings, so their sessions are shorter. */
export const CLINIC_ADMIN_SESSION_TTL_SECONDS = 6 * 60 * 60;

/**
 * Owner site session lifetime — deliberately much shorter than a staff
 * shift, since an owner session can read and delete every record on the
 * platform.
 */
export const OWNER_SESSION_TTL_SECONDS = 2 * 60 * 60;

/** Minimum length for the owner's password (set via scripts/createOwner.ts). */
export const OWNER_PASSWORD_MIN_LENGTH = 12;

/**
 * The one setting for wrong-PIN lockout (and the owner's wrong passwords):
 * after `maxAttempts` wrong tries within `windowMinutes`, the ACCOUNT is
 * locked for `lockMinutes`, however the phone number or ID was typed. Used
 * by web login (patients, staff, owner), the doctor's signing PIN and the
 * delete-account PIN — see services/pinLockout.ts. Change it here only.
 */
export const PIN_LOCKOUT = { maxAttempts: 5, windowMinutes: 5, lockMinutes: 5 } as const;

/** Older names, kept in step with PIN_LOCKOUT. */
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = PIN_LOCKOUT.maxAttempts;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = PIN_LOCKOUT.windowMinutes * 60;

/** Patient PIN-reset OTP: how long a code is valid, and how many guesses it tolerates. */
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Guards against SMS-bombing a phone number with repeated OTP requests. */
export const OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;
export const OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS = PIN_LOCKOUT.windowMinutes * 60;

/** After this many SMS failures in a row, the owner page warns that Africa's Talking may be down. */
export const SMS_FAILURE_WARNING_THRESHOLD = 3;

/** A "Request records" or phone-verification code is valid this long after it is shown or sent. */
export const ONE_TIME_CODE_TTL_SECONDS = 10 * 60;
/** Wrong tries allowed on one such code before it stops working. */
export const ONE_TIME_CODE_MAX_ATTEMPTS = 5;
