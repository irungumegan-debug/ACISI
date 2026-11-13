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

## Compliance documents

- **DPIA (Data Protection Impact Assessment), 13 Nov 2026:**
  `docs/compliance/DPIA-2026-11-13.md`. Show it in full whenever the owner
  asks for "the DPIA" or "the DPI report". Update it (new version and date)
  when an action in its section 6 is completed.
- **DHA self-attestation** (draft reference DHS-1793019691629-GXVFAJJTJ, not yet
  submitted or paid). Answers must be checked against the code, never assumed.
  Remaining one-week plan, in order: (1) tamper-resistant audit log in the
  database, inactivity logoff, under-18 check at portal signup; (2) AES-256
  encryption of sensitive data at rest; (3) ICD-11 coded diagnoses incl. MOH
  notifiable diseases; (4) notifiable-disease alert + automatic weekly IDSR
  report; (5-6) FHIR R4 interface ready for the Kenya HIE; (7) retest, update
  the attestation, submit.
