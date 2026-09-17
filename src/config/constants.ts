/**
 * Bump CONSENT_VERSION whenever CONSENT_PROMPT_TEXT changes meaningfully.
 * Consent rows store the version that was shown, so we can always reproduce
 * exactly what a patient agreed to — required for Data Protection Act
 * accountability, not just nice-to-have.
 */
export const CONSENT_VERSION = 'v1';

export const CONSENT_PROMPT_TEXT =
  'ACISI keeps a basic health record (name, visits) shared across clinics you check into, so any clinic ' +
  'can see your history. We only use it for your care. Agree?';

export const MAX_STAFF_PIN_ATTEMPTS = 3;

export const HISTORY_ENCOUNTER_LIMIT = 5;

/** Clinics shown per page in the USSD check-in clinic-selection menu. */
export const CLINICS_PER_PAGE = 5;

/** Departments shown per page in the USSD check-in department-selection menu. */
export const DEPARTMENTS_PER_PAGE = 5;

/** Staff dashboard web session lifetime — roughly a shift. */
export const DASHBOARD_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Brute-force guard on the dashboard PIN login endpoint. */
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

/**
 * Patient portal "My records" login — phone number + SMS OTP instead of a
 * permanent password, since these are not tech-savvy users (see
 * docs/ARCHITECTURE.md). Deliberately short-lived: a code that leaks after
 * expiry is useless, and patients re-request one each visit anyway.
 */
export const PATIENT_OTP_LENGTH = 6;
export const PATIENT_OTP_TTL_SECONDS = 5 * 60;
export const PATIENT_OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Brute-force / SMS-cost guard on OTP requests, same pattern as LOGIN_RATE_LIMIT_*. */
export const PATIENT_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;
export const PATIENT_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

/** Patient portal "My records" session lifetime — shorter than staff's since it's read access to health data from a personal, less-controlled device. */
export const PATIENT_SESSION_TTL_SECONDS = 30 * 60;
