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

- **Switch SMS provider (to-do, owner, target ~21 Nov 2026):** SMS still run
  on Africa's Talking **sandbox** (no real delivery). Owner is applying for a
  sender ID with a Kenyan SMS provider (TextSMS mentioned). When credentials
  arrive: add the provider in `src/services/smsService.ts` (all SMS go through
  `sendSms`), confirm where message content is stored (must stay in Kenya;
  update the Privacy Notice, DPIA and ODPC records if the processor changes),
  test real delivery, then turn on multi-factor login (`STAFF_MFA_ENABLED=true`,
  runbook "Turning on multi-factor login"). Until then MFA stays OFF and the
  DHA "Multi-Factor Authentication" box stays unticked.

## Compliance documents

- **DPIA (Data Protection Impact Assessment), 13 Nov 2026:**
  `docs/compliance/DPIA-2026-11-13.md`. Show it in full whenever the owner
  asks for "the DPIA" or "the DPI report". Update it (new version and date)
  when an action in its section 6 is completed.
- **DHA self-attestation** (draft reference DHS-1793019691629-GXVFAJJTJ, not yet
  submitted or paid). Answers must be checked against the code, never assumed.
  Done 14 Nov 2026 (on branch, deploy with the runbook "DHA fixes" release):
  tamper-resistant audit log, 15-min inactivity logoff, under-18 check,
  AES-256-GCM encryption at rest (fields + files); multi-factor login for
  admins and doctors (off until STAFF_MFA_ENABLED=true, see runbook).
  ICD-11 list download from WHO was blocked in-session; owner may upload the
  ICD-11 MMS Simple Tabulation file. Remaining, in order:
  (3) ICD-11 coded diagnoses incl. MOH
  notifiable diseases; (4) notifiable-disease alert + automatic weekly IDSR
  report; (5-6) FHIR R4 interface: base built 14 Nov (src/fhir/, /fhir/r4); adapt to
  DHA's HIE spec (identifiers, profiles, auth, submission) after the owner's
  call with DHA; (7) retest, update
  the attestation, submit.
