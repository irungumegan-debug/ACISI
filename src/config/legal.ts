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
