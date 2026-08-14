# ACISI Architecture

## Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma
- **Session state / job queue:** Redis + BullMQ
- **USSD gateway:** Africa's Talking
- **Payments:** M-Pesa Daraja (STK Push)

See the README for the trade-off reasoning behind each choice.

## Multi-tenancy

Single shared database. Clinic-owned data (`Staff`, `CheckIn`, `Encounter`)
carries a `clinicId` foreign key. `Patient` deliberately has **no**
`clinicId` — portability across clinics is the core product feature, so a
patient exists once and accumulates `Encounter` rows at whichever clinics
they check into. A clinic is selected within the shared USSD menu via a
short, non-secret `Clinic.ussdCode` (e.g. "482"), not a separate shortcode.

## USSD session handling

Africa's Talking's protocol is stateless per HTTP request: on every keystroke
it POSTs `{ sessionId, phoneNumber, text }`, where `text` is the *entire*
accumulated input for the session so far (e.g. `"1*482*1"`), not just the
latest keystroke. The app is responsible for tracking where the user is in
the menu tree.

**Normal path:** `src/ussd/session.ts` caches an explicit state machine
context (`{ state, data }`) in Redis, keyed by `sessionId`, TTL'd to
`USSD_SESSION_TTL_SECONDS` (set below AT's own ~180s session timeout so we
never trust a session AT itself has already expired). On each request we
only need to process the *last* token of `text`, since prior tokens are
already reflected in the cached state — O(1) per keystroke.

**Recovery path:** if Redis has no entry for a `sessionId` that AT is still
mid-conversation with (server restart, evicted cache key, network blip),
`src/ussd/fsm.ts`'s `replaySession()` rebuilds context by silently replaying
every token except the last one through the same state handlers, then
processes the final token for real. This works safely because every state
handler with an external side effect is itself idempotent per session:

- `registerPatient` is only called once, from `CHECKIN_NEW_PATIENT_SEX`,
  after which `patientId` lives in `session.data` — a replay re-derives it
  by looking the patient up by phone number instead of re-registering.
- `initiateCheckIn` treats `CheckIn.ussdSessionId` (unique) as an idempotency
  key: a second call for the same session returns the existing row instead
  of triggering a second STK push. **This is the specific mechanism that
  prevents a dropped-session replay from double-charging a patient.**

Each state handler follows one convention throughout: when it transitions to
a new state, it composes that state's *entry prompt* itself as part of its
own response, rather than requiring a second "render" call. The only
exception is `MAIN_MENU`, which is invoked with the `ENTER_SENTINEL` on a
genuinely fresh session (`text === ''`) to render the welcome menu without
interpreting the sentinel as a menu choice.

## Data model & Data Protection Act posture

See `prisma/schema.prisma` for full field-level comments. Key decisions:

- **Minimal necessary data:** `Patient` collects only name, phone, DOB, sex,
  county — no national ID or other sensitive identifiers at MVP. Add fields
  later only behind an explicit, versioned consent capture, not by default.
- **Consent is append-only:** `Consent` rows are never updated in place; a
  revocation is a new row with `granted: false`. `hasActiveDataSharingConsent()`
  always reads the *latest* row, so history is preserved but current status
  is still a cheap single query. Every grant records the `version` of the
  consent copy shown (`CONSENT_VERSION` in `src/config/constants.ts`), so we
  can always reproduce exactly what a patient agreed to.
- **Consent before collection, not after:** the check-in flow asks for
  consent (`CHECKIN_CONSENT`) *before* asking a new patient for their name,
  DOB, or sex — declining ends the session with nothing persisted.
- **Audit trail:** `AuditLog` is intended to be append-only at the
  application level (no update/delete code paths call it). Every patient
  data access — not just mutations — should log a row; see
  `PATIENT_HISTORY_VIEWED` in `src/ussd/states/patientHistory.ts` for the
  pattern (log *before* returning data, with who accessed it and why).
  Enforcing append-only at the database level (e.g. revoking UPDATE/DELETE
  grants for the app's DB role) is a deliberate follow-up, not yet applied.
- **Consent-gated history access:** `staffHistoryEnterPhone` checks
  `hasActiveDataSharingConsent()` before returning any cross-clinic history,
  independent of whether the patient record itself exists — so a future
  consent-revocation flow (not yet built) will correctly cut off access
  without any change to the history-viewing code path.

## M-Pesa check-in billing flow

1. Patient confirms check-in over USSD (`CHECKIN_CONFIRM`, state machine).
2. `checkInService.initiateCheckIn` creates a `CheckIn` row
   (`PENDING_PAYMENT`) and calls `mpesa/stkPush.ts`, which triggers Daraja's
   STK push to the patient's phone. The USSD session ends here — Daraja's
   response is asynchronous and outlives the ~180s USSD session.
3. `scheduleStkStatusCheck` queues a BullMQ job (`stk-status-check`) 90s out
   as a safety net in case Daraja's callback never arrives.
4. When the patient enters their M-Pesa PIN, Daraja POSTs the result to
   `POST /api/mpesa/callback` (`src/mpesa/router.ts`), which is parsed by
   `mpesa/callback.ts` and applied by `checkInService.applyPaymentResult`:
   logs an `MpesaTransaction` row (with the full raw payload, for
   reconciliation), flips `CheckIn.status` to `PAID`/`FAILED`, and — on
   success — creates the `Encounter` that makes this visit show up in the
   patient's portable history.
5. `applyPaymentResult` is idempotent per `CheckIn` (`status !==
   PENDING_PAYMENT` short-circuits), so it's safe to call from both the
   callback route and the `stk-status-check` fallback worker without double
   counting a payment.
6. An SMS receipt is queued (`enqueueSmsReceipt`) regardless of outcome, so
   the patient has a record even if they've already left the USSD session.

The callback route always responds `200` (per Daraja's expectations) except
for a structurally malformed body — a business-logic failure (e.g. no
matching `CheckIn`) is logged, not surfaced as an HTTP error, since
Daraja retries indefinitely on non-2xx.

## Known MVP limitations / deliberate scope cuts

- Consent revocation has no USSD flow yet (only grant, at registration).
  The schema and `hasActiveDataSharingConsent()` already support it.
- Staff PIN lockout is per-session only (`MAX_STAFF_PIN_ATTEMPTS`), not a
  persistent account lockout across sessions.
- `AuditLog` is append-only by convention, not by DB-level grant
  restriction yet.
- No insurer-facing API exists yet — the data model is deliberately kept
  clean and minimal so that layer can be added later without a schema
  rework.
