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
