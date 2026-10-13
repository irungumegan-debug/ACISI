# ACISI Architecture

## Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma
- **Session state / job queue:** Redis + BullMQ
- **USSD gateway:** Africa's Talking
- **Payments:** M-Pesa Daraja (STK Push)
- **Staff/doctor console:** Vite + React + TypeScript + Tailwind (`dashboard/`), served under `/console`
- **Marketing site + patient portal:** Vite + React + TypeScript (`web/`), served at `/`

Both frontends are served by the same Express process — see "Two frontend
SPAs, one origin" below.

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

- **Minimal necessary data:** `Patient` collects name, phone, DOB, sex and
  county, plus — optionally — an ID document (national ID, passport, birth
  certificate or alien ID, with its type) and a next of kin, needed for
  Digital Health Agency certification. The Privacy Notice gives their legal
  basis (identifying the patient correctly, reaching someone on their
  behalf); patients acknowledge it per clinic (see "Privacy Notice and Terms
  of Service" below). Rules live in `src/services/patientIdentity.ts`: check-in
  and walk-in only fill in what's entered (never wipe what's on file), the
  staff patient page can also clear fields, walk-in lookup only says whether
  details are on file, audit rows name the fields changed but never their
  values, and account deletion wipes them.
- **Consent is append-only:** `Consent` rows are never updated in place; a
  revocation is a new row with `granted: false`. Checks such as
  `clinicHasRecordAccess()` always read the *latest* row, so history is preserved but current status
  is still a cheap single query. Every grant records the `version` of the
  consent copy shown (`CONSENT_VERSION` in `src/config/constants.ts`), so we
  can always reproduce exactly what a patient agreed to.
- **Two separate consents, not one:** `ConsentType` distinguishes
  `PLATFORM_REGISTRATION` (required to have a record at all — the check-in
  flow asks for this, `CHECKIN_CONSENT`, *before* asking a new patient for
  their name, DOB, or sex; declining ends the session with nothing
  persisted, agreeing is recorded as a granted consent row by
  `registerPatient` once registration completes) from
  sharing with other clinics. Since Oct 2026 sharing is approved **per
  clinic** (`CLINIC_RECORD_ACCESS`, see "Patients, shared phones, login,
  sharing and files"); the old platform-wide `CROSS_CLINIC_RECORD_SHARING`
  question is no longer asked, but a past "yes" still counts until the
  patient revokes it in the portal.
- **Audit trail:** `AuditLog` is intended to be append-only at the
  application level (no update/delete code paths call it). Every patient
  data access — not just mutations — should log a row; see
  `PATIENT_HISTORY_VIEWED` in `src/ussd/states/patientHistory.ts` for the
  pattern (log *before* returning data, with who accessed it and why).
  Enforcing append-only at the database level (e.g. revoking UPDATE/DELETE
  grants for the app's DB role) is a deliberate follow-up, not yet applied.
- **Consent-gated history access:** every path that shows other clinics'
  history (`getScopedHistory` for the console and doctor view,
  `staffHistoryEnterPhone` over USSD, file downloads) asks
  `clinicHasRecordAccess()` for the viewing clinic, so revoking in the
  portal cuts access off everywhere at once.

## Privacy Notice and Terms of Service

The approved documents live in `web/src/content/privacy.md` and `terms.md`
and are shown word for word at `/privacy` and `/terms`
(`web/src/lib/legalMarkdown.ts` parses the few Markdown features they use).
`tests/web/legal.test.ts` pins each file's SHA-256 and proves the rendered
text equals the file, so any wording change is deliberate.

Acceptances are append-only `LegalAcceptance` rows, each carrying the
document's version: its "Last updated" date, kept in `src/config/legal.ts`
(a test fails if that and the file disagree). "Accepted?" always means "a
row exists for the *current* version", so changing a date asks everyone
again. See `src/services/legalService.ts`:

| Where | Asked | Recorded |
|---|---|---|
| Patient portal signup | always (required) | Terms + Privacy, patient |
| Patient portal, after login | until the current Terms are accepted | Terms + Privacy, patient |
| Patient web check-in | first check-in at each clinic, and per new Privacy version | Privacy, patient, clinic, check-in |
| Walk-in (front desk) | patient's first walk-in at the clinic, and per new Privacy version | Privacy, patient, staff member, clinic, check-in |
| Clinic registration | always (required) | Terms + Privacy, clinic, admin |
| Staff console, after login | until the current Terms are accepted | Terms, staff member, clinic |

The server refuses each request without its box; the UIs disable the
button until it's ticked (`legalBoxSatisfied` in `web/src/lib/legal.ts` and
its copy in `dashboard/src/lib/legal.ts`).

## M-Pesa check-in billing flow

1. Patient confirms check-in over USSD (`CHECKIN_CONFIRM`, state machine).
2. `checkInService.initiateCheckIn` creates a `CheckIn` row
   (`PENDING_PAYMENT`) and calls `mpesa/stkPush.ts`, which triggers Daraja's
   STK push to the patient's phone. The USSD session ends here — Daraja's
   response is asynchronous and outlives the ~180s USSD session.
3. The callback alone isn't trusted to arrive. `checkInService.queryCheckInPayment`
   asks Safaricom's M-Pesa Express Query API (`/mpesa/stkpushquery/v1/query`,
   `mpesa/verify.ts`) with the check-in's `CheckoutRequestID`: PAID on
   ResultCode 0, FAILED on a definite failure (1, 1019, 1032, 1037, 2001),
   still pending otherwise (including Daraja's "being processed" error). It
   runs from two places, throttled to once per 10s per check-in via Redis:
   - the patient portal's status poll (`GET /api/patients/checkin/:id`), from
     ~20s after the STK push;
   - a once-a-minute BullMQ sweep (`stk-status-check` queue, scheduled by
     `scheduleCheckInPaymentSweep`) over check-ins pending 1–60 minutes. Any
     still pending after 60 minutes become `NEEDS_REVIEW` (not `FAILED`: the
     patient may have paid) and show in the staff queue's "Payment didn't go
     through" section.
4. When the patient enters their M-Pesa PIN, Daraja POSTs the result to
   `POST /api/mpesa/callback` (`src/mpesa/router.ts`), which is parsed by
   `mpesa/callback.ts` and applied by `checkInService.applyPaymentResult`
   (the query uses the same function): logs an `MpesaTransaction` row (with
   the full raw payload, for reconciliation), flips `CheckIn.status` to
   `PAID`/`FAILED`, and — on success — creates the `Encounter` that makes
   this visit show up in the patient's portable history.
5. Whichever answer arrives first wins — callback, query, or front desk
   confirming by hand with the M-Pesa code from the patient's SMS
   (`confirmCheckInPaidManually`, which stores the code, who and when). The
   status change is a conditional update (`UPDATE … WHERE status IN
   (PENDING_PAYMENT, NEEDS_REVIEW)`, in one transaction with the
   `MpesaTransaction` row and `Encounter`), so a later or simultaneous answer
   changes nothing and nothing is counted twice. Each outcome writes one log
   line: `checkInId`, `source` (callback/query/staff), `resultCode` and the
   new `status` — never phone numbers, receipt codes or payloads.
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
tracked in Redis) — a numeric PIN with no throttling would be trivially
brute-forceable, and this endpoint gates access to every patient at the
clinic, so it gets the same security treatment as everything else patient-data-adjacent in this codebase.

**Patient portal (`src/portal/`).** A third surface, alongside USSD and the
staff dashboard, for patients on the web — all under `/api/patients`. See
"Patients, shared phones, login, sharing and files" below for sign-in.
Patients use the same opaque-Redis-session pattern as the staff dashboard
(`src/portal/session.ts`, cookie `acisi_patient_session`). Web check-in
(`POST /api/patients/checkin`) calls the exact same
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
clinic, `patientService.getScopedHistory` decides what history they see —
this clinic's own encounters always (that's not "cross-clinic sharing", it's
the clinic's own data), other clinics' encounters only if the patient has an
active `CROSS_CLINIC_RECORD_SHARING` consent, otherwise just a
`hasHiddenHistoryElsewhere` flag with no contents. This is the same function
the doctor dashboard's `getEncounterForDoctor` uses (`src/services/encounterService.ts`)
— one place decides the consent-gating rule, not two copies that could drift.
The doctor path adds its own, tighter layer on top: it can only ever be
reached for a patient currently in the doctor's own department's queue at
their own clinic (`assertEncounterInDoctorQueue` — keyed by `encounterId`,
scoped by `clinicId` + `checkIn.departmentId`; a mismatch is
indistinguishable from "doesn't exist," so a doctor can't probe for other
clinics'/departments' patients), and every view writes a
`PATIENT_HISTORY_VIEWED` audit row (who, when, which patient) regardless of
which of the two paths was used.

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
`Encounter`. Front-desk patient detail is deliberately still read-only
(diagnosis/prescription only get written by the doctor console's
consultation form, `encounterService.submitConsultation`) — front desk's job
is payment/checkout, not clinical notes, so it never needed its own write path.

## Two frontend SPAs, one origin

`web/` (marketing site, signup/login, patient portal) and `dashboard/`
(staff/doctor console) are separate Vite builds, served by the same Express
process with no CORS anywhere: `web/dist` at `/`, `dashboard/dist` under
`/console` (`src/app.ts`). `dashboard/vite.config.ts` sets
`base: '/console/'` only for the production build (so its asset URLs
resolve correctly once served from that path) and its `<BrowserRouter
basename>` matches it — both stay `/` in dev, where each app runs on its own
Vite dev server port with its own `/api` proxy, same pattern as before.
Doctor/staff login (`web/src/pages/LoginPage.tsx`) calls the same
`/api/staff/auth/login` the console's own login form does, then does a full
`window.location.href` navigation to `/console/...` rather than a
client-side route change — it's a different SPA bundle, but the session
cookie the login call already set carries over unchanged (same origin), so
the console's own `AuthContext` just picks it up on load. The console keeps
its own internal `/console/login` too (reached if an unauthenticated visit
lands there directly) — a harmless, fully-functional fallback against the
same endpoint, not a second identity system.

**Async route-handler errors no longer crash the process.** Discovered
while smoke-testing this routing change: Express 4 (unlike 5) does not
forward a rejected promise from an `async (req, res) => ...` handler to
`next(err)` automatically, and virtually every handler in this codebase is
written that way with no try/catch. A transient failure (e.g. Postgres
briefly unreachable) on any request became an unhandled rejection that took
the whole server down — a real, unrelated production-readiness bug this
change surfaced, not something introduced by it. Fixed by importing
`express-async-errors` once at the top of `src/app.ts`, which patches
Express's shared Router/Route prototypes so those rejections now reach
`errorHandler` (a clean `500`) instead. No route handler code changed.

## Patients, shared phones, login, sharing and files (Oct 2026)

**One phone, several patients.** `Patient.phoneNumber` is no longer unique:
a parent and their children can share a phone, each with their own ACISI
ID (`ACS-48217`, five random digits; older `ACI-7F2K` IDs still work).
What stops duplicates instead is `registerPatient`: it takes a Postgres
advisory lock on the phone number and refuses the same first and last
name with the same date of birth (or no date to tell them apart) —
`DuplicatePatientError`, which each caller turns into "already registered",
"reuse the existing record" (walk-in, replayed USSD session) or "link it"
(import). Every place that used to look a patient up by phone now handles
a list: the console asks staff to pick, the portal asks "who are you?",
USSD shows a short person menu (and puts "My Records" behind the person's
PIN on a shared phone).

**A clinic's patients.** `ClinicPatient` links a clinic to patients it added
("Add patient", bulk import) or saw (backfilled from check-ins). A link
gives the clinic the patient's details and its *own* records — never other
clinics' records. `clinicCanSeePatientWhere` is the one scoping filter.
Bulk import (`patientImportService`) previews errors and duplicates before
anything is saved and sends no SMS; "Send invitations" sends the
registration SMS in batches, so the clinic controls the cost.

**Sign-in (`patientAuthService`).** Patients get one OTP ever — at first login
(or forgot PIN): phone → `PhoneOtp` (hashed, 5 minutes, single use, 5
guesses, 3 per number per hour counted in the database, plus a per-IP cap)
→ pick the person → confirm date of birth (protects against recycled
numbers; year only when it was worked out from an age; none on file means
"ask your clinic") → PIN twice → the ACISI ID screen, which needs "I have
saved my ACISI ID" (`Patient.idSavedAt`). The steps between the OTP and the
PIN are carried by a short-lived Redis "setup flow" token. Everyday login is
phone or ACISI ID + PIN. The lock (5 wrong → 15 minutes) lives on the
account (`pinFailedAttempts`, `pinLockedUntil`), so changing identifier
gives no extra guesses; by phone, a wrong PIN counts against every account
on it, and a PIN matching several people asks which. "Keep me signed in"
gives a 30-day session; revocation markers outlive it.

**Records from other clinics (`recordAccessService`).** `getScopedHistory`
asks `clinicHasRecordAccess(patient, clinic)`: the latest
`CLINIC_RECORD_ACCESS` consent row for that clinic, or — for patients who
said yes before per-clinic approval existed — their old
`CROSS_CLINIC_RECORD_SHARING` answer until they revoke it. "Request past
records" texts a code (10 minutes, single use, 5 wrong tries, 3 per patient
per clinic per hour); the patient reads it out, or types their own PIN on
the front-desk screen (same lock as login). The patient sees and revokes
access in the portal. Requests, approvals, wrong codes, revocations and
every view are in `AuditLog`, which now has `clinicId` and `patientId`
columns.

**Files (`fileStorageService`).** JPG/PNG/PDF only, recognised by magic bytes,
20 MB each. Multer writes uploads to `FILE_STORAGE_DIR/.incoming` under random
names; after the content check they're renamed into `FILE_STORAGE_DIR`
(0700, files 0600, random 48-hex names, no extension). Several photos of a
paper file become one PDF (pdfkit), read one at a time because the server
has 1 GB of RAM. Served only through logged-in routes with the records
rule: the uploading clinic and the patient always; other clinics' uploads
and the patient's own uploads only with the patient's approval. Patient
uploads are labelled; deleting an account deletes them (clinic uploads stay,
like visit records).

**SMS.** All new SMS go through `smsSender.sendSms` (one segment, never logs
the number or text): registration, queue join / "you're next" for walk-ins
(no department name), record-access code, OTP. `POST /api/sms/inbound`
handles STOP replies; "Reply STOP" is only added to SMS text when
`SMS_REPLY_STOP_ENABLED` is on.

**Logs.** `utils/logger.ts` logs requests without query strings or cookies,
redacts phone/PIN/code/record fields, masks digit runs in error messages and
drops database error messages (which can echo saved values).

## Known MVP limitations / deliberate scope cuts

- Revoking a clinic's access to records from other clinics is portal-only
  (no USSD flow).
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
