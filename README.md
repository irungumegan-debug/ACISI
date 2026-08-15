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

### 6. Start the dev server

```bash
npm run dev
```

The server exposes:
- `POST /api/ussd` — Africa's Talking USSD webhook
- `POST /api/mpesa/callback` — Daraja STK push result callback
- `GET /healthz` — liveness check

Point your Africa's Talking sandbox USSD channel and Daraja callback URL at
your dev server's public URL (e.g. via `ngrok http 3000`).

## Tests

```bash
npm test
```

## Scripts

| Command                  | Purpose                                   |
|---------------------------|--------------------------------------------|
| `npm run dev`             | Start dev server with hot reload           |
| `npm run build`           | Compile TypeScript to `dist/`              |
| `npm start`               | Run the compiled server                    |
| `npm test`                | Run the test suite                         |
| `npm run prisma:migrate`  | Create/apply a dev migration               |
| `npm run prisma:studio`   | Browse the database                        |
