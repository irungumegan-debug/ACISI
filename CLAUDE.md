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
  test real delivery, then optionally allow SMS login codes as well
  (`STAFF_MFA_SMS_ENABLED=true`, runbook "Turning on multi-factor login").
- **Multi-factor login (authenticator app), built 20 Nov 2026:** admins and
  doctors use an authenticator app (TOTP, `src/utils/totp.ts`,
  `src/services/staffMfaService.ts`); needs no SMS. Live only once deployed
  AND `STAFF_MFA_ENABLED=true` on the server (runbook "Turning on
  multi-factor login"). Tick the DHA "Multi-Factor Authentication" box only
  after the owner confirms both, then mark DPIA action A2 done (new version).

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
  admins and doctors (authenticator app since 20 Nov; off until
  STAFF_MFA_ENABLED=true, see runbook).
  ICD-11 coded diagnoses done 14 Nov (WHO MMS 2025-01 bundled in
  src/assets/icd11/, doctors must pick 1-5 codes; FHIR Condition coded).
  Notifiable-disease alerts + weekly summary built 14 Nov
  (src/services/notifiableDiseases.ts), list from the IDSR Technical
  Guidelines 3rd ed. (2022) Table 5 + MOH 505 form (owner uploaded the PDFs).
  Open items: checklist section "To confirm" (docs/testing/manual-test-checklist.md).
  Structured prescriptions + allergy warning built 14 Nov (DHA ePrescription
  IG codes in src/assets/dha/). DHA FHIR guides (Kenya Core 1.0.0, Patient
  Summary 0.1.0, ePrescription 0.1.0) download from fhir.dha.go.ke/ig/...
  /package.tgz (host now allowed in the ACISI environment); HIE contact: interoperability@dha.go.ke bounced (16 Nov), no working
  address known.
  Routine reports (monthly/quarterly/annual, IDSR monthly table) and public
  health events (event-based surveillance, fill MOH 505 event and death rows)
  built 14 Nov (src/services/{routineReportService,publicHealthEventService}.ts).
  20 Nov 2026: DHA never replied (interoperability@dha.go.ke bounces; no
  answer from raymondbett@dha.go.ke), so the owner is submitting without
  their answers. Final answer sheet, with open items declared as gaps G1-G9:
  docs/compliance/DHA-self-attestation-answers-2026-11-20.md. After
  certification, if DHA ever answers: automatic IDSR/KHIS submission (G3) and
  connecting the FHIR interface (src/fhir/, /fhir/r4) to the HIE (G2).
  Goal (owner, 20 Nov): raise the attestation score from ~53% to at least 70%
  ("ready to launch") by building the unticked items. Waiting for the owner's
  screenshots of the portal form to list every unticked item; MFA (G1) built
  first.
