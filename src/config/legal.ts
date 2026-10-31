/**
 * Current versions of ACISI's legal documents: each one's "Last updated"
 * date (as YYYY-MM-DD) from web/src/content/privacy.md and terms.md, which
 * are shown at acisi.co.ke/privacy and /terms.
 *
 * Every acceptance is recorded against the version shown (LegalAcceptance),
 * so changing a version here asks everyone again: patients and staff accept
 * the new Terms at their next login, and patients acknowledge the new
 * Privacy Notice at their next check-in at each clinic.
 *
 * When a document changes, update its .md file and its date here together —
 * tests/web/legal.test.ts fails if the two ever disagree.
 */
export const PRIVACY_NOTICE_VERSION = '2026-10-08';
export const TERMS_OF_SERVICE_VERSION = '2026-10-08';

/**
 * Staff confidentiality undertaking, accepted at staff signup and clinic
 * registration, and once at the next console login by staff who have not
 * accepted this version. The approved text is web/src/content/confidentiality.md,
 * shown at CONFIDENTIALITY_UNDERTAKING_PATH. When the text changes, update
 * the file, this version date and the hash in tests/web/legal.test.ts
 * together (everyone is then asked again).
 */
export const CONFIDENTIALITY_UNDERTAKING_VERSION = '2026-10-31';
/** The public page with the full undertaking, linked from every tick-box. */
export const CONFIDENTIALITY_UNDERTAKING_PATH = '/confidentiality-undertaking';

/** The tick-box wording for the undertaking, shown at staff signup, clinic registration and the console screen. */
export const CONFIDENTIALITY_UNDERTAKING_CHECKBOX = 'I have read and agree to the ACISI Confidentiality Undertaking.';
