# ACISI

USSD-first clinic management platform for small clinics in Kenya. One shortcode
routes patients and clinic staff into a shared platform — no smartphone or app
required. Patients get a portable record that follows them between clinics;
clinics get instant context on new patients, even on a first encounter.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design,
data model, and the reasoning behind the USSD session-recovery strategy.

## Stack

- **Backend:** Node.js + TypeScript + Express
- **Database:** PostgreSQL via Prisma
- **Session state / job queue:** Redis + BullMQ
- **USSD gateway:** Africa's Talking
- **Payments:** M-Pesa Daraja (STK Push / Lipa Na M-Pesa Online)
- **Staff/doctor console:** Vite + React + TypeScript + Tailwind (`dashboard/`), served under `/console` by the same Express app
- **Owner site:** Vite + React + TypeScript + Tailwind (`owner/`), served under `/owner` by the same Express app
- **Marketing site + patient portal:** Vite + React + TypeScript (`web/`), served at `/` by the same Express app

## Getting started

### 1. Prerequisites

- Node.js 18+
- Docker (for local Postgres + Redis), or your own instances of each

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` with:
- Your Africa's Talking username + API key (sandbox credentials are fine for dev)
- Your M-Pesa Daraja consumer key/secret, shortcode, and passkey (sandbox app)
- A publicly reachable `MPESA_CALLBACK_URL` (use `ngrok` or similar in dev — Daraja
  cannot reach `localhost`)

**Never commit `.env` or hardcode credentials in source.** `.env` is gitignored;
`src/config/env.ts` validates required variables at boot and fails fast if any
are missing.

### 4. Start local infrastructure

```bash
docker compose up -d
```

### 5. Run database migrations

```bash
npm run prisma:migrate
```

### 6. Seed demo data (clinics + a staff login)

```bash
npm run prisma:seed
```

Seeds 7 demo clinics (with a General/Gynecology/Dental/Pediatrics department
each on the first one) and three staff logins, all PIN `730194`:
- `ACI-STF-TEST` — front-desk receptionist
- `ACI-STF-DEMO` — doctor, assigned to the General department
- `ACI-STF-ADMN` — clinic admin

Staff and doctors log in with their `staffCode` (e.g. `ACI-STF-TEST`) + PIN —
never a phone number (see `docs/ARCHITECTURE.md`'s identity section).

### 7. Start the dev server

```bash
npm run dev
```

The server exposes:
- `POST /api/ussd` — Africa's Talking USSD webhook
- `POST /api/mpesa/callback` — Daraja STK push result callback
- `/api/staff/*` — staff dashboard API (auth, patients, check-in queue, live events)
- `GET /healthz` — liveness check

Point your Africa's Talking sandbox USSD channel and Daraja callback URL at
your dev server's public URL (e.g. via `ngrok http 3000`).

### 8. Start the staff/doctor console (separate terminal)

```bash
npm run dev:dashboard
```

Opens on its own Vite dev server port and proxies `/api` requests to the
backend on port 3000 (see `dashboard/vite.config.ts`), so it runs side by
side with the backend with independent hot reload.

### 9. Start the marketing site + patient portal (another terminal)

```bash
npm run dev:web
```

Same pattern as the console — its own Vite dev server, proxying `/api` to
the backend (see `web/vite.config.ts`). This is where `/`, `/about`,
`/contact`, `/signup`, `/login`, and the patient portal (`/patient`) live.

In production there are no separate frontend servers — the backend serves
`dashboard/dist` under `/console`, `owner/dist` under `/owner`, and `web/dist` at `/` directly from the
same origin (see `npm run build` below), so there's no CORS config anywhere
in this app. Doctor/staff signup and login redirect to `/console/...` with a
full page navigation after authenticating (the session cookie set by that
request carries over, since it's the same origin) — everything else is
client-side routing within whichever of the SPAs is active.

### Walk-in check-in (front desk)

For patients who arrive without checking in remotely. On the console's
**Queue** page, front-desk roles (receptionist, clinician, admin — not
doctors) use **Check in walk-in patient**: search by phone (any Kenyan
format, normalised to `+254…`), confirm the patient found or register a new
one (never a duplicate for the same phone), and add them to the same queue
as remote check-ins. Walk-ins are stored with `source = WALK_IN` and status
`NO_FEE` — no ACISI check-in fee and no M-Pesa prompt — and record which
staff member checked them in. From there they go through the doctor and
checkout like any other visit.

If staff tick "Patient agreed to receive SMS from the clinic", the consent
is saved (`SMS_CLINIC_MESSAGES`) and a one-off invite is sent (wording in
`src/services/smsTemplates.ts`); unticked, nothing is sent. A failed SMS
never blocks the check-in. The queue shows today's walk-in vs remote counts.
Logic: `src/services/walkInService.ts`; routes: `src/dashboard/walkIn.ts`.
Staff can instead tick "Patient does not want SMS": that is saved on the
patient (also switchable on the patient page) and blocks the receipt and
visit-summary SMS.

### Departments

Each clinic defines its own departments. The clinic admin picks them while
registering (common ones to tick, or their own; at least one, no duplicate
names). Each department has a name, a short code (2–6 capital letters or
digits, unique in the clinic, kept for future USSD check-in), an
active/inactive state, and an optional consultation fee. Under **Settings →
Departments** the admin can add, rename, change the code or fee, and
deactivate or reactivate. A department that has visits can only be
deactivated, never deleted. Inactive departments disappear from patient
check-in and walk-in, but past visits keep them.

Doctors work in one or more departments (set under **Settings → Staff &
doctors**) and only see those departments' patients, everywhere in the
console. The queue can be filtered and grouped by department. Checkout
pre-fills the department's fee, falling back to the clinic default. When a
clinic has more than one department, the daily summary totals money by
department. Logic: `src/services/departmentService.ts`.

### Doctor assignment and "Change doctor"

When a patient checks in, ACISI picks a doctor automatically: only doctors in
the chosen department who are in today (logged in, or marked in), preferring
one who is free, then the shortest waiting line
(`src/services/doctorAssignmentService.ts`). Front desk can move a patient
who is still **waiting** to another doctor in the same department who is in
today, using **Change doctor** on the queue card. Doctors can't, a patient
already with a doctor can't be moved, every move is logged
(`ENCOUNTER_DOCTOR_CHANGED`), and open queues, including the doctor's own,
refresh straight away (`src/services/doctorReassignmentService.ts`).

### Checkout payments (front desk)

After the doctor finishes, the queue shows **Bill & pay** for the visit.
The bill starts with the clinic's default consultation fee; staff add lab,
medication or other lines (whole KES) and an optional discount, which needs
a reason. Payments can be split across methods until the balance is
covered: **Cash** (amount received → change due), **Card** (amount plus
the card machine reference or last 4 digits — no live card integration),
and **M-Pesa** — either "Request payment" (an STK prompt to the patient's
phone, status shown live, with retry) or a manually entered M-Pesa code
(format-checked, and a code can never be used twice). The bill shows
Unpaid / Partly paid / Paid with the balance. Only clinic admins can void a
payment, with a reason; voided payments are kept, never deleted. When the
bill is fully paid, one receipt SMS is sent (unless the patient opted out)
and a printable receipt is shown. Admins get **Daily summary** (totals by
method, paid visits, unpaid/partly paid list, any date) and set accepted
methods, till/paybill details and the default fee under **Settings →
Payments**.

**Money boundary:** checkout money goes to the *clinic's* till/paybill.
ACISI only records payments and triggers prompts; it never holds clinic
money. ACISI's own till only ever collects the remote check-in fee, which
is a separate flow (`src/mpesa/stkPush.ts`).

**STK push is sandbox-only for now.** It uses a separate Daraja app from
the check-in fee, configured with `CLINIC_DARAJA_CONSUMER_KEY`,
`CLINIC_DARAJA_CONSUMER_SECRET`, `CLINIC_DARAJA_PASSKEY`,
`CLINIC_DARAJA_SHORTCODE` (sandbox `174379`) and `CLINIC_MPESA_CALLBACK_URL`
(`https://<your-domain>/api/mpesa/clinic-callback`) — credentials live only
in environment variables. Without them, "Request payment" is hidden and
staff enter M-Pesa codes manually. Logic: `src/services/billingService.ts`;
routes: `src/dashboard/billing.ts`.

### 10. The owner site (`/owner`)

A separate site for the company owner, focused on the business rather than
individual patients:

- **Overview** — platform totals: clinics, doctors, registered patients
  (a count only), visits and revenue.
- **Clinics** — every registered clinic with its revenue (total and last
  30 days), recent visits, and number of doctors and staff, sortable by
  revenue. Opening a clinic shows its numbers, its **doctors** (department,
  visits handled, last login) and its **front-desk & admin staff**, each of
  whom can be deactivated/reactivated (logs them out immediately; staff are
  never erased, since their names stay on the visits they handled). The
  clinic itself can be deactivated too.
- **Activity log** — the full audit trail, read-only.
- **Delete a patient** — deletes an account by its patient ID (see below),
  for a patient who asks but can't do it from the portal.

The owner site never displays patient names, contact details or medical
records — there is no patient list or patient record view at all.

There is no signup form for it. The owner account is created privately, in
one of two ways — either way only a bcrypt hash of the password is stored,
never the password itself, and nothing about it is in the code:

**Option A — environment variables (no shell needed; easiest on Railway).**
Add `OWNER_EMAIL`, `OWNER_NAME` and `OWNER_PASSWORD` (12+ characters) to the
service's variables and let it redeploy. On startup, if no owner exists for
that email, one is created; the deploy log says "Owner account created from
environment variables". Then **delete `OWNER_PASSWORD`** from the variables.
It never overwrites an existing account, so a leftover value can't reset
your password later.

**Option B — one-time setup script (from the server's shell):**

```bash
npm run create-owner -- you@example.com "Your Name"
```

It asks for a password (12+ characters, not echoed). Running it again for
the same email resets the password and logs out every open owner session —
this is also how to reset a forgotten owner password.
Locally, run the owner site's dev server with `npm run dev:owner`.

**PIN rules.** Every PIN is exactly 6 digits (staff also log in over USSD,
where only digits work reliably). The system refuses PINs that are easy to
guess: anything that reads as a date (birthdays especially), repeated or
sequential digits (111111, 121212, 123456, 654321), and the last six digits
of the account's phone number. The rules live in one place,
`src/utils/pinPolicy.ts`, and only apply when a PIN is chosen — logging in
just checks the stored PIN.

**Forgotten PINs are self-service.** Patients, staff and doctors all reset
their own PIN from the login page ("Forgot your PIN?"): a one-time code goes
by SMS to the phone number on their account. A successful reset also lifts
any "too many attempts" lockout and logs out their other sessions. (Without
a reset, the lockout still lifts by itself after 15 minutes.) This relies on
SMS delivery being live.

**Deleting a patient account** — by the owner (by patient ID), or by
patients themselves from the portal's *Account* tab (they re-enter their
PIN) — erases
everything that identifies them: name, phone number, email, date of birth,
county, PIN, and the phone number on their M-Pesa records. Their visits and
payments are kept with no name attached, so clinics keep their medical and
financial records. Open appointments are cancelled, cross-clinic sharing
consent is withdrawn, and they're logged out everywhere. Their phone number
is freed, so they can register again later as a new patient. This can't be
undone.

## Production

ACISI runs on a HostAfrica server in Kenya (patient data stays in Kenya).
See [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md) for how it's set up, how to
update it, and backups.

## Tests

```bash
npm test
```

## Scripts

| Command                  | Purpose                                                    |
|---------------------------|-------------------------------------------------------------|
| `npm run dev`             | Start backend dev server with hot reload                    |
| `npm run dev:dashboard`   | Start the staff/doctor console's Vite dev server             |
| `npm run dev:web`         | Start the marketing site + patient portal's Vite dev server  |
| `npm run dev:owner`       | Start the owner site's Vite dev server                       |
| `npm run build`           | Compile backend to `dist/`, then build all three frontend SPAs |
| `npm start`               | Run the compiled server (serves the SPA builds in production) |
| `npm run create-owner`    | Create the owner account, or reset its password              |
| `npm test`                | Run the backend test suite                                  |
| `npm run prisma:seed`     | Seed demo clinics + a staff login                            |
| `npm run prisma:migrate`  | Create/apply a dev migration                                 |
| `npm run prisma:studio`   | Browse the database                                          |

`npm start` applies any pending database migrations (`prisma migrate
deploy`) before starting the server, so merging a change that includes a
migration needs no extra step on the host: the next deploy brings the
database up to date first. It only ever applies migrations that haven't run
yet, so it's safe on every start.

`npm run build` is also the Render (or similar) build command — it installs
and builds all three frontend SPAs as part of the same step, so a bare
`npm install && npx prisma generate && npm run build` on the backend service
is enough; there's no separate frontend service to deploy.
