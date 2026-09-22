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
each on the first one) and three staff logins, all PIN `1234`:
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
`dashboard/dist` under `/console` and `web/dist` at `/` directly from the
same origin (see `npm run build` below), so there's no CORS config anywhere
in this app. Doctor/staff signup and login redirect to `/console/...` with a
full page navigation after authenticating (the session cookie set by that
request carries over, since it's the same origin) — everything else is
client-side routing within whichever of the two SPAs is active.

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
| `npm run build`           | Compile backend to `dist/`, then build both frontend SPAs   |
| `npm start`               | Run the compiled server (serves both SPA builds in production) |
| `npm test`                | Run the backend test suite                                  |
| `npm run prisma:seed`     | Seed demo clinics + a staff login                            |
| `npm run prisma:migrate`  | Create/apply a dev migration                                 |
| `npm run prisma:studio`   | Browse the database                                          |

`npm run build` is also the Render (or similar) build command — it installs
and builds both frontend SPAs as part of the same step, so a bare
`npm install && npx prisma generate && npm run build` on the backend service
is enough; there's no separate frontend service to deploy.
