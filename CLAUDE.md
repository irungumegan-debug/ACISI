# ACISI

USSD-first clinic management platform for small clinics in Kenya. See
`README.md` for setup and `docs/ARCHITECTURE.md` for the system design.

## Planned features

- **USSD check-in:** planned for Dec 2026 / early 2027. When live, add the
  USSD code to the walk-in invite SMS (see invite template:
  `buildWalkInInviteSms` in `src/services/smsTemplates.ts`).
- **Clinic checkout payments (live):** Go live with M-Pesa STK push per clinic
  (production Daraja credentials or a payment provider like
  IntaSend/Pesapal/Paystack), and add live card payments. Currently sandbox
  only. (See `src/mpesa/clinicStk.ts`; `CLINIC_MPESA_ENV` only allows
  `sandbox` today.)
