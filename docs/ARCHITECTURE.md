# ACISI Architecture

## Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma
- **Session state / job queue:** Redis + BullMQ
- **USSD gateway:** Africa's Talking
- **Payments:** M-Pesa Daraja (STK Push)
- **Staff dashboard:** Vite + React + TypeScript + Tailwind (`dashboard/`), served by the same Express process

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
- **Two separate consents, not one:** `ConsentType` distinguishes
  `PLATFORM_REGISTRATION` (required to have a record at all — the check-in
  flow asks for this, `CHECKIN_CONSENT`, *before* asking a new patient for
  their name, DOB, or sex; declining ends the session with nothing
  persisted, agreeing is recorded as a granted consent row by
  `registerPatient` once registration completes) from
  `CROSS_CLINIC_RECORD_SHARING` (optional, asked afterward at
  `CHECKIN_CROSS_CLINIC_CONSENT`, defaults to **not shared** unless the
  patient explicitly opts in — declining still registers and checks the
  patient in, it just keeps the record clinic-local).
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

**Auth.** Staff and doctors authenticate with `staffCode` (a system-generated
`ACI-STF-XXXX` identifier, `Staff.staffCode`) + PIN — never phone number.
Phone number is still collected and stored on `Staff` for SMS/contact
purposes, but it authenticates nothing; both the dashboard
(`src/dashboard/auth.ts`) and USSD staff login (`src/ussd/states/staffLogin.ts`,
which now has a `STAFF_ENTER_CODE` step before `STAFF_ENTER_PIN`) look staff
up by `staffCode` (`staffService.findActiveStaffWithClinicByCode` /
`findActiveStaffByCode`) and share the same `verifyStaffPin` — same bcrypt
compare, same audit log write. The dashboard session mechanism: a browser
needs a persistent login, so a successful login creates an opaque token
(`crypto.randomBytes`, not a JWT — no signing/verification complexity
needed) mapped to `{staffId, staffCode, staffName, role, clinicId,
clinicName}` in Redis (`src/dashboard/session.ts`), TTL'd to
`DASHBOARD_SESSION_TTL_SECONDS` (8h, roughly a shift), handed to the browser
as an httpOnly cookie. Same "server holds the truth, client just holds a
lookup key" pattern as the USSD session store — logout is a single Redis
delete. The login endpoint itself is rate-limited per staffCode
(`LOGIN_RATE_LIMIT_MAX_ATTEMPTS` failures per `LOGIN_RATE_LIMIT_WINDOW_SECONDS`,
tracked in Redis) — a 4-digit PIN with no throttling would be trivially
brute-forceable, and this endpoint gates access to every patient at the
clinic, so it gets the same security treatment as everything else patient-data-adjacent in this codebase.

**Patient portal (`src/portal/`).** A third surface, alongside USSD and the
staff dashboard, for patients on the web: register, login, forgot/reset PIN,
web check-in, and records — all under `/api/patients`. Patients log in with
their phone number or `patientCode` (`ACI-XXXX`, `Patient.patientCode`) plus
a PIN (`Patient.pinHash`), using the same opaque-Redis-session pattern as the
staff dashboard (`src/portal/session.ts`, cookie `acisi_patient_session`).
OTP (`Otp` model, SMS via Africa's Talking) is reset-only — sent when a
patient forgets their PIN, or to let a patient who registered via USSD (and
so never set one) set their first PIN; it is never used for everyday login.
Web check-in (`POST /api/patients/checkin`) calls the exact same
`checkInService.initiateCheckIn` USSD uses, so payment/idempotency/SMS
behavior is identical regardless of channel.

**Clinic onboarding (`src/clinics/`, `src/dashboard/registration.ts`,
`src/dashboard/clinicSettings.ts`).** Two distinct signup paths, both public
(no session required):
`POST /api/clinics/register` creates a brand-new `Clinic` — with a
persistent, regenerable `inviteCode` (e.g. `SUNRISE-7F2K`,
`clinicService.registerClinic`) — plus its first `Staff` row with role
`ADMIN`, in one transaction. `POST /api/staff/register` is how everyone
else (doctors, front-desk staff) joins an *existing* clinic: it requires
that clinic's current `inviteCode` and never creates an ADMIN
(`staffService.registerStaffViaInviteCode`, `SIGNUP_ROLES` excludes
`ADMIN`). An admin can view or regenerate their clinic's invite code from
the dashboard settings page — `GET`/`POST /api/staff/clinic/invite-code`,
gated by `requireAdmin` — without any broader staff-management UI; that's
deliberately out of scope for now.

**Departments, the doctor dashboard, and checkout (`src/services/departmentService.ts`,
`src/services/encounterService.ts`, `src/dashboard/doctor.ts`).** A `Department`
belongs to a `Clinic`; a doctor (`Staff.departmentId`) is assigned to exactly
one; a `CheckIn` is routed to exactly one at check-in time (USSD's new
`CHECKIN_SELECT_DEPARTMENT` step, inserted right after clinic selection —
every clinic gets a default "General" department at registration so there's
always somewhere to route to). `Encounter` carries its own `EncounterStatus`
(`WAITING → IN_CONSULTATION → READY_FOR_CHECKOUT → DONE`), deliberately
separate from `CheckInStatus` (payment-only) — the two start together (a
successful payment creates the Encounter at `WAITING`) but progress
independently from there. A doctor's queue (`GET /api/staff/doctor/queue`)
is `WAITING`/`IN_CONSULTATION` encounters scoped to their own clinic *and*
department — never another department's or clinic's patients, never a
general lookup (`getDoctorQueue`, `assertEncounterInDoctorQueue`). Opening a
patient moves `WAITING → IN_CONSULTATION` and logs a `PATIENT_HISTORY_VIEWED`
audit row; submitting the consultation form (diagnosis + prescription) moves
it to `READY_FOR_CHECKOUT` — it never triggers checkout or SMS itself, by
design (`submitConsultation`). Checkout is a front-desk-only action
(`checkoutEncounter`, `POST /api/staff/checkins/:id/checkout`) that moves it
to `DONE` and enqueues a *second*, separate SMS — the visit summary
(diagnosis/prescription), via a new `visit-summary-sms` BullMQ queue/worker
— distinct from the payment-receipt SMS `enqueueSmsReceipt` already sends
right after payment; the two are independent events, not a replacement of
each other.

**Manual payment confirmation** (`checkInService.confirmCheckInPaidManually`,
`POST /api/staff/checkins/:id/confirm-payment`) is the real, permanent,
audited feature for a bank-only clinic (or one taking payment through its
own till): it shares the exact same "mark paid" tail as a successful M-Pesa
callback (`finalizePaidCheckIn` — Encounter creation, realtime publish, SMS
receipt), just skipping the STK push, and logs `CHECK_IN_PAID_MANUALLY` with
the confirming staff member's ID (audit's `staffId` + `createdAt` is the
"who and when"). `scripts/devMarkCheckInPaid.ts` is a separate, narrower
dev-only shortcut (`checkInService.devMarkCheckInPaid`, gated on
`NODE_ENV !== 'production'`) for local testing without a real M-Pesa
sandbox — it is not the manual-confirmation feature and carries no staff
attribution, which is exactly why the real feature above exists as its own
audited path rather than just relaxing this script's guard.

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

**No schema changes for the dashboard.** All four MVP dashboard features
(login, search, patient detail, live queue) are read-only against data the
USSD side already writes — `Patient`, `Clinic`, `Staff`, `CheckIn`,
`Encounter`. Patient detail is deliberately read-only for this build (no
notes/diagnosis editing) — a real write surface on clinical data is a
meaningfully bigger scope than a read view, and wasn't worth the risk on a
one-week timeline to a demo.

## Known MVP limitations / deliberate scope cuts

- Consent revocation has no USSD flow yet (only grant, at registration).
  The schema and `hasActiveDataSharingConsent()` already support it.
- Staff PIN lockout is per-session only in USSD (`MAX_STAFF_PIN_ATTEMPTS`);
  the dashboard login has its own, separate Redis-backed rate limit
  (`LOGIN_RATE_LIMIT_MAX_ATTEMPTS`) since a web form doesn't have USSD's
  natural per-session boundary.
- `AuditLog` is append-only by convention, not by DB-level grant
  restriction yet.
- Dashboard patient detail is read-only — no notes/diagnosis editing yet.
- The live check-in queue's event bus is single-instance (see above).
- No insurer-facing API exists yet — the data model is deliberately kept
  clean and minimal so that layer can be added later without a schema
  rework.
