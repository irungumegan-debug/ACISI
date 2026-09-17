# ACISI Architecture

## Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma
- **Session state / job queue:** Redis + BullMQ
- **USSD gateway:** Africa's Talking
- **Payments:** M-Pesa Daraja (STK Push)
- **Staff dashboard:** Vite + React + TypeScript + Tailwind (`dashboard/`), served by the same Express process
- **Patient portal:** Vite + React + TypeScript + Tailwind (`portal/`), also served by the same Express process, at `/portal`

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

## Clinic selection and patient self-service

The check-in flow originally asked patients to type a clinic code from
memory. That's now replaced with a paginated selection menu
(`CHECKIN_SELECT_CLINIC`, `src/ussd/states/clinicSelect.ts`): `listActiveClinics()`
fetches all active clinics once per request (fine at MVP scale — see the
comment on that function for when to revisit), and `buildClinicSelectionPrompt`
renders `CLINICS_PER_PAGE` (5) of them at a time, numbered `1`-`5`, with a
`0. Next page` control that wraps back to page 1 after the last page. The
selected page number lives in `session.data.clinicPage`, so it survives the
same Redis-backed session (and dropped-session replay) as everything else in
the flow. Once a clinic is picked, `proceedToPatientLookup` (still in
`patientCheckIn.ts`) takes over exactly where the old code-entry state left
off — patient lookup, consent gate, registration.

`Clinic.ussdCode` still exists in the schema but is no longer read by the
patient-facing flow now that selection is by list position, not typed code.
Left in place rather than migrated out, since it's harmless and may be
useful later (e.g. an internal/admin reference, or as the basis for the
future `*XXX*[clinic-id]#` per-clinic shortcode extension).

Once a clinic is picked, the flow now asks for a **department**
(`CHECKIN_SELECT_DEPARTMENT`, `src/ussd/states/departmentSelect.ts`) before
patient lookup — same paginated-menu pattern as clinic selection, reading
from `listActiveDepartments()`. This is what lets the staff dashboard queue
group/filter check-ins by department regardless of whether they came in
over USSD or the web portal (`CheckIn.channel`). `Department` is a plain,
platform-wide table (not per-clinic) at MVP, seeded with General/
Gynecology/Dental/Pediatrics in `prisma/seed.ts` — the same list every
clinic sees. If clinics eventually need different department lists, the
natural extension is a `ClinicDepartment` join table; not built now because
every seeded clinic offers the same four departments today.

The main menu also gained a **My Records** option: a patient can view their
own visit history directly, keyed off the session's own phone number with no
additional identity input (`src/ussd/states/mainMenu.ts`, option `3`). This
is the same `getPortableHistory` used by staff, but bypasses
`hasActiveDataSharingConsent()` — that check exists to gate *staff* (a third
party) viewing a patient's history, not a patient viewing their own data.
It's still logged to `AuditLog` (`PATIENT_SELF_VIEWED_HISTORY`) for
consistency with "every access gets a row," even though the DPA rationale
for third-party access logging doesn't strictly apply to self-access.

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

## Staff dashboard

Separate surface from the USSD patient flow by design: patients never touch
the dashboard, staff never touch USSD (per the two-pillar architecture).
They share only `services/` and the Postgres/Redis layer underneath —
`src/dashboard/` never imports from `src/ussd/` or vice versa.

**Auth.** `src/dashboard/auth.ts` reuses the exact staff PIN verification
already built for USSD login (`staffService.findActiveStaffWithClinicByPhone`
+ `verifyStaffPin` — same bcrypt compare, same audit log write). What's new
is the session mechanism: a browser needs a persistent login, so a
successful login creates an opaque token (`crypto.randomBytes`, not a JWT —
no signing/verification complexity needed) mapped to `{staffId, clinicId,
staffName, clinicName}` in Redis (`src/dashboard/session.ts`), TTL'd to
`DASHBOARD_SESSION_TTL_SECONDS` (8h, roughly a shift), handed to the browser
as an httpOnly cookie. Same "server holds the truth, client just holds a
lookup key" pattern as the USSD session store — logout is a single Redis
delete. The login endpoint itself is rate-limited per phone number
(`LOGIN_RATE_LIMIT_MAX_ATTEMPTS` failures per `LOGIN_RATE_LIMIT_WINDOW_SECONDS`,
tracked in Redis) — a 4-digit PIN with no throttling would be trivially
brute-forceable, and this endpoint gates access to every patient at the
clinic, so it gets the same security treatment as everything else patient-data-adjacent in this codebase.

**Authorization scoping.** Patient search (`GET /api/staff/patients`) and
patient detail (`GET /api/staff/patients/:id`) are both scoped to patients
who have a `CheckIn` or `Encounter` at the logged-in staff member's own
`clinicId` — not a global patient search. This is enforced server-side on
*both* endpoints, not just hidden in the search UI: a staff member can't
view an arbitrary patient by guessing/crafting an ID for a patient who's
never been to their clinic. Once a patient does have a relationship with the
clinic, the detail view shows their full portable history across all
clinics (`getPortableHistory`, same function the USSD staff-history lookup
uses) — that cross-clinic visibility is the whole point of the platform, it's
just gated behind having a legitimate reason to be looking at this patient
at all.

**Live check-in queue.** `src/services/realtimeEvents.ts` is a small
in-process pub/sub (Node `EventEmitter`, channel-per-`clinicId`) that
`checkInService.applyPaymentResult` publishes to whenever a `CheckIn` flips
to `PAID`. `GET /api/staff/events` (`src/dashboard/events.ts`) is a
Server-Sent Events endpoint — one dashboard client subscribes per open
browser tab, gets pushed a JSON payload the instant their clinic's check-in
lands, no polling. SSE over WebSockets because this is one-directional
(server → browser) and `EventSource` needs zero extra protocol handling.
`GET /api/staff/checkins/today` gives the initial snapshot on page load;
SSE events are prepended to that list client-side from then on.

This event bus is **in-process, single-instance** — it works because the
whole app is one Express process today. If this ever runs on more than one
instance, a dashboard client connected to instance A would never see a
payment that landed via a callback routed to instance B. Moving to Redis
pub/sub for this would be a small, contained change (same publish/subscribe
call sites, different transport) — not done now because it isn't needed yet.

**Consultation workflow (Waiting → In Consultation → Done).** This is the
dashboard's one real write surface on clinical data: `consultationService.ts`
layers `Encounter.consultationStatus`/`notes`/`prescription`/`completedAt`
onto the existing `Encounter` row, clinic-scoped the same way patient search
and detail are (`loadClinicScopedEncounter` — a staff member can't act on an
encounter that isn't at their own clinic, even by guessing an id).
`GET /api/staff/checkins/today` now reads `Encounter` (not just `CheckIn`)
so it can show department and consultation status alongside the patient/
phone/check-in-time it already showed; `POST /:encounterId/start` and
`POST /:encounterId/checkout` are the two state transitions. Checkout is
the one place prescriptions/notes get written and is also what triggers the
checkout SMS (`visitSummarySmsQueue`, a separate BullMQ job/worker from the
existing payment-receipt job — different message, different trigger point).
**Live updates here are polling** (the dashboard re-fetches `/checkins/today`
every 5s), not a second SSE channel: the existing SSE feed above is
payment-only and reshaping it to also carry consultation-status changes
wasn't worth the complexity when polling every few seconds is explicitly
fine for this use case. The SSE endpoint itself is untouched and still
fires on new arrivals; the dashboard just no longer needs it now that
polling covers both new arrivals and status changes in one mechanism.

## Patient portal

A second, separate web surface (`portal/` frontend, `src/portal/` backend),
served at `/portal` alongside the dashboard at `/` — same single-origin,
no-CORS setup. Patients never see the staff dashboard and staff never see
the portal, same two-pillar separation as USSD vs. dashboard.

**Web check-in reuses the USSD check-in machinery, not a copy of it.**
`POST /api/portal/checkin` calls the exact same `checkInService.initiateCheckIn`
(and so the same M-Pesa STK push) the USSD `CHECKIN_CONFIRM` state calls. A
phone number ACISI has never seen goes through the same consent +
registration step USSD collects (`registerPatient`) before the check-in is
created — the endpoint responds `REGISTRATION_REQUIRED` instead of erroring
when it hits an unknown number with no registration payload yet, so the
frontend can show a short sign-up form and resubmit. `CheckIn.ussdSessionId`
(the existing idempotency guard against double STK pushes) is reused as-is
for the web path too: the portal generates its own per-attempt id
client-side and sends it as `web:<id>` instead of an Africa's Talking
session id — same column, same uniqueness guarantee, no schema change
needed for a second channel's idempotency key. `CheckIn.channel` records
which path a given check-in came in on.

**OTP auth, not a password.** "My records" is phone number + a 6-digit SMS
code, deliberately not a permanent password — these are the same
not-necessarily-tech-savvy patients USSD serves, just reached through a
phone browser instead of a feature-phone menu. The OTP itself never touches
Postgres: it's a hashed code in Redis (`portal:otp:<phone>`,
`PATIENT_OTP_TTL_SECONDS` TTL), rate-limited on both request
(`PATIENT_OTP_REQUEST_RATE_LIMIT_*`) and verify attempts
(`PATIENT_OTP_MAX_VERIFY_ATTEMPTS`) using the same generic Redis rate
limiter (`src/utils/rateLimit.ts`) the dashboard's PIN login uses — extracted
from that login endpoint specifically so this didn't need a second
implementation. Once verified, the session (`src/portal/session.ts`) is the
same opaque-token-in-Redis pattern as the dashboard's staff session and the
USSD session store, just scoped to `{ phoneNumberE164 }` rather than a
`patientId` — deliberately, since a patient can verify before they have any
ACISI record at all (before their first check-in), so every protected route
re-resolves the `Patient` row by phone at request time instead of trusting a
cached id.

**Records are strictly self-scoped.** `GET /api/portal/visits` filters by
the phone number on the caller's own OTP-verified session — never a body,
query, or path parameter — so there's no id a patient could pass to see
someone else's history. It logs `PATIENT_SELF_VIEWED_HISTORY` on every
access, same audit convention as everywhere else patient data is read.

## Known MVP limitations / deliberate scope cuts

- Consent revocation has no USSD flow yet (only grant, at registration).
  The schema and `hasActiveDataSharingConsent()` already support it.
- Staff PIN lockout is per-session only in USSD (`MAX_STAFF_PIN_ATTEMPTS`);
  the dashboard login has its own, separate Redis-backed rate limit
  (`LOGIN_RATE_LIMIT_MAX_ATTEMPTS`) since a web form doesn't have USSD's
  natural per-session boundary.
- `AuditLog` is append-only by convention, not by DB-level grant
  restriction yet.
- Dashboard patient detail (the cross-clinic history view) is still
  read-only — the consultation workflow's notes/prescription fields are
  edited only through the queue's checkout form, not the patient detail
  page.
- The live check-in queue's event bus is single-instance (see above); the
  consultation workflow's live updates are polling, not SSE, by choice
  (see "Consultation workflow" above), so this limitation doesn't apply to
  it the same way.
- `Department` is a single platform-wide list, not per-clinic — every
  clinic currently offers the same four departments. A `ClinicDepartment`
  join table is the natural extension if that stops being true.
- No doctor/clinician login exists yet — front-desk staff enter the
  prescription and notes at checkout on the clinician's behalf, using the
  same staff login as everything else in the dashboard. A separate
  clinician-facing view is future work, not part of this build.
- The patient portal's OTP session (`PATIENT_SESSION_TTL_SECONDS`, 30 min)
  is deliberately shorter-lived than the staff dashboard's (8h) — it's
  read access to personal health data from a patient's own, less-controlled
  device, re-verified each visit rather than kept logged in.
- No insurer-facing API exists yet — the data model is deliberately kept
  clean and minimal so that layer can be added later without a schema
  rework.
