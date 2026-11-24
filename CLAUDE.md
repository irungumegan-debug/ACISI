# ACISI

USSD-first clinic management platform for small clinics in Kenya. See
`README.md` for setup and `docs/ARCHITECTURE.md` for the system design.

## Planned features

- **USSD check-in:** planned for Dec 2026 / early 2027. When live, add the
  USSD code to the walk-in invite SMS (see invite template:
  `buildWalkInInviteSms` in `src/services/smsTemplates.ts`).
- **ACISI check-in fee on live M-Pesa: confirmed working 20 Nov 2026**
  (owner paid a real STK prompt from their phone; payment showed on
  acisi.co.ke). Production Daraja, Buy Goods till (runbook "Switching ACISI's
  M-Pesa to production"). Note: clinic checkout prompts switch off on a
  production server (`clinicStkConfigured`), so clinic checkout M-Pesa is
  cash/manual until the item below is done.
- **Clinic checkout payments (live):** Go live with M-Pesa STK push per clinic
  (production Daraja credentials or a payment provider like
  IntaSend/Pesapal/Paystack), and add live card payments. Currently sandbox
  only. (See `src/mpesa/clinicStk.ts`; `CLINIC_MPESA_ENV` only allows
  `sandbox` today.)

- **SMS provider: Mobile Sasa, live and confirmed working 23 Nov 2026**
  (PR #69 merged and deployed, token on the server; owner received the test
  SMS and a real OTP from "ACISI" and used it). Sender ID approved on
  Safaricom only. `src/services/mobileSasaClient.ts`, used by
  `sendSms` whenever `MOBILESASA_API_TOKEN` is set on the server (Africa's
  Talking kept for USSD). Non-Safaricom numbers are not tried
  (`MOBILESASA_SAFARICOM_ONLY`, default true); screens explain and offer the
  fallback (runbook "Switching SMS to Mobile Sasa"). Still to do (owner): confirm where Mobile
  Sasa stores message content (must stay in Kenya) and update the Privacy
  Notice, DPIA and ODPC records for the new processor; then optionally
  `STAFF_MFA_SMS_ENABLED=true`.
- **Staff PIN reset by clinic admin only (owner, 23 Nov 2026):** staff and
  doctors can't reset their own PIN by SMS; the clinic admin does it (Settings
  → Staff → Reset PIN). An admin's PIN: another admin of the clinic, else the
  owner with `npm run reset-staff-pin` (runbook "Resetting a staff PIN").
  Patients keep the SMS reset.
- **At least 2 admins per clinic (owner, 23 Nov 2026):** `MIN_CLINIC_ADMINS`.
  Reminder banner while a clinic has 1. Deactivating an admin is allowed
  down to 1 (owner: someone fired must lose access at once); only the last
  admin can't be deactivated. "Make admin" (`makeStaffAdmin`) promotes front desk / clinician / lab
  staff, never doctors (one role per account). Invite-code signup can't
  choose ADMIN, on purpose.
- **Multi-factor login (authenticator app), built 20 Nov 2026:** admins and
  doctors use an authenticator app (TOTP, `src/utils/totp.ts`,
  `src/services/staffMfaService.ts`); needs no SMS. Live only once deployed
  AND `STAFF_MFA_ENABLED=true` on the server (runbook "Turning on
  multi-factor login"). `STAFF_MFA_ENABLED=true` set on the server 24 Nov
  2026. Owner, 24 Nov: setup moved out of the login screen into Settings →
  Multi-factor login (doctors get a Settings page with just that); until set
  up, PIN-only login plus a reminder banner; once set up, the code is
  always asked. Tick the DHA "Multi-Factor Authentication" box only
  after the owner confirms both, then mark DPIA action A2 done (new version).

## Compliance documents

- **Patient address / residence is NOT collected** (owner, 21 Nov 2026): not in
  the Privacy Notice, DPIA or ODPC registration; no GPS. Never add address or
  location fields for patients without the owner first updating those. The
  DHA "Residence/Address" box stays unticked.

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
  Owner considered making ICD-11 optional (23 Nov) and decided to keep it
  required: notifiable-disease alerts and IDSR/MOH 505 reports depend on
  the codes, and the DHA answers say it is required.
  Notifiable-disease alerts + weekly summary built 14 Nov
  (src/services/notifiableDiseases.ts), list from the IDSR Technical
  Guidelines 3rd ed. (2022) Table 5 + MOH 505 form (owner uploaded the PDFs).
  Open items: checklist section "To confirm" (docs/testing/manual-test-checklist.md).
  Structured prescriptions + allergy warning built 14 Nov (DHA ePrescription
  IG codes in src/assets/dha/). DHA FHIR guides (Kenya Core 1.0.0, Patient
  Summary 0.1.0, ePrescription 0.1.0) download from fhir.dha.go.ke/ig/...
  /package.tgz (host now allowed in the ACISI environment). HIE: public API
  docs at hie-docs.dha.go.ke. Sandbox (AfyaConnect) credentials appear on the
  DHA portal's "HIE sandbox" page automatically once the attestation is
  submitted and the application fee paid (seen 21 Nov 2026); UAT booking via
  afyaconnect.dha@gmail.com (interoperability@dha.go.ke bounces). Score at
  submission time: 76% (owner, 21 Nov). Plan and API summary:
  docs/compliance/HIE-integration-plan.md (hosts hie-docs, ilm-dev and
  hie-test .dha.go.ke allowed in the ACISI environment). Steps 1-4 built
  20 Nov (src/hie/, src/dashboard/hie.ts, console "National HIE" page; off
  until HIE_ENABLED=true with DHA's credentials, runbook "Connecting to the
  national HIE"). Steps 5-8 (Shared Health Record: consent per visit, send at
  checkout via queue hie-shr-send, doctor reads other facilities' records,
  close visit) built 20 Nov in src/hie/shr*.ts. Owner has no facility codes yet: admins find the clinic by
  name or MFL code on that page.
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
  ("ready to launch"). Owner pasted sections 3, 4 and 6 (not yet 1, 2, 5, 7).
  Built 20-21 Nov for them: service orders, vital signs + warnings, problem
  list, critical lab alerts, quality measures, fuller visit record + care
  plan, family history, dispensing, on-screen surveillance banner,
  IHR flag, emailed SCDSC reports, LOINC lab codes. What to tick once
  deployed: end of docs/compliance/DHA-self-attestation-answers-2026-11-20.md.
  Score estimate (formula reverse-engineered from section 4: component on =
  half, feature share = half, "Required" components weigh double): ~70-75%
  overall; the HIE critical gap needs DHA credentials regardless.
