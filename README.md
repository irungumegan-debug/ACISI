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
- **Staff dashboard:** Vite + React + TypeScript + Tailwind (`dashboard/`), served by the same Express app
- **Patient portal:** Vite + React + TypeScript + Tailwind (`portal/`), also served by the same Express app, at `/portal`

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

Seeds 7 demo clinics, 4 departments (General, Gynecology, Dental,
Pediatrics), and one staff login for the dashboard: phone
`+254700000001`, PIN `1234`.

### 7. Start the dev server

```bash
npm run dev
```

The server exposes:
- `POST /api/ussd` — Africa's Talking USSD webhook
- `POST /api/mpesa/callback` — Daraja STK push result callback
- `/api/staff/*` — staff dashboard API (auth, patients, live queue, consultation workflow)
- `/api/portal/*` — patient portal API (clinic/department lookup, web check-in, OTP login, own visit history)
- `GET /healthz` — liveness check

Point your Africa's Talking sandbox USSD channel and Daraja callback URL at
your dev server's public URL (e.g. via `ngrok http 3000`).

### 8. Start the staff dashboard (separate terminal)

```bash
npm run dev:dashboard
```

Opens on its own Vite dev server port and proxies `/api` requests to the
backend on port 3000 (see `dashboard/vite.config.ts`), so the two run
side by side with independent hot reload. Log in with the seeded staff
login above. In production there's no separate dashboard server — the
backend serves `dashboard/dist` directly from the same origin at `/` (see
`npm run build` below), so there's no CORS config anywhere in this app.

### 9. Start the patient portal (separate terminal)

```bash
npm run dev:portal
```

Opens at `http://localhost:5174/portal/` (its Vite dev server also runs
under the `/portal/` base path, matching how it's served in production —
see `portal/vite.config.ts`) and proxies `/api` the same way the dashboard
does. Two flows:
- **Check in** — clinic, department, phone number, then (for a phone
  number ACISI hasn't seen before) a short registration step, then the
  same M-Pesa STK push the USSD flow uses.
- **My records** — phone number + a one-time SMS code (no password),
  then a read-only list of past visits, diagnoses, and prescriptions.

To test the SMS paths (OTP codes, the checkout summary SMS) end-to-end,
use your own phone number and real Africa's Talking sandbox credentials in
`.env` — with placeholder credentials, both send attempts fail loudly
(visible in the server logs / a 502 from the relevant endpoint) rather than
silently, which is deliberate.

In production, the backend also serves `portal/dist` directly from the
same origin, at `/portal` (the dashboard keeps `/`) — still no separate
frontend service, no CORS.

**No new environment variables are required** for either the staff
dashboard queue/checkout features or the patient portal — both reuse the
Africa's Talking and M-Pesa credentials already in `.env`. OTP codes, rate
limits, and session lifetimes are code constants in `src/config/constants.ts`,
following the same pattern as the existing staff login rate limiting.

## Tests

```bash
npm test
```

## Scripts

| Command                  | Purpose                                                    |
|---------------------------|-------------------------------------------------------------|
| `npm run dev`             | Start backend dev server with hot reload                    |
| `npm run dev:dashboard`   | Start the staff dashboard's Vite dev server                 |
| `npm run dev:portal`      | Start the patient portal's Vite dev server                  |
| `npm run build`           | Compile backend to `dist/`, then build both SPAs            |
| `npm start`               | Run the compiled server (serves both SPA builds in production) |
| `npm test`                | Run the backend test suite                                  |
| `npm run prisma:seed`     | Seed demo clinics, departments, and a staff login            |
| `npm run prisma:migrate`  | Create/apply a dev migration                                 |
| `npm run prisma:studio`   | Browse the database                                          |

`npm run build` is also the Render (or similar) build command — it installs
and builds both `dashboard/` and `portal/` as part of the same step, so a
bare `npm install && npx prisma generate && npm run build` on the backend
service is enough; there's no separate frontend service to deploy.
