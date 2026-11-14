# Changelog

Plain-language record of what changed in ACISI, which data each change
touches, and who can use it. Newest first.

## 2026-11-14: Allergy list

One database change, additive (`20261114140000_patient_allergies`); undo
script in `prisma/rollback/`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| A1 | **Record allergies:** substance, type (medicine, food, environment, other), reaction and severity, for patients in the doctor's own queue. Shown in a red banner at the top of the consultation page. | New: patient allergies (substance, reaction and removal reason encrypted at rest) | Doctors |
| A2 | **Allergy history:** an allergy recorded in error is removed with a reason, never deleted; removed ones are listed with who, when and why. Only the clinic that recorded an allergy can remove it. | Patient allergies | Doctors |
| A3 | **Sharing:** other clinics' allergies follow the visit-records rule (sharing consent or a records code); otherwise the doctor is told some are hidden. | — | Doctors |
| A4 | **Patient portal:** "My allergies" lists current allergies. **FHIR:** AllergyIntolerance in Patient/$everything (removed ones as entered-in-error). Recording and removal are audit-logged with IDs only. | — | Patients |

## 2026-11-14: FHIR R4 interface (Kenya HIE readiness)

HL7 FHIR R4 (4.0.1) at `/fhir/r4`, for exchange with the Kenya Health
Information Exchange. No database change.

| # | What changed | Who |
|---|---|---|
| H1 | `GET /fhir/r4/metadata`: CapabilityStatement (public; no patient data). Claims only what is served. | — |
| H2 | `GET /fhir/r4/Patient/:id`: Patient resource (ACISI ID, ID document, name, sex, birth date, phone, next of kin). Same access rule as the patient page. | Front desk, admins, doctors |
| H3 | `GET /fhir/r4/Patient/:id/$everything`: Bundle with Patient, Organization (clinic), Practitioner, Encounter, Condition (diagnosis), MedicationRequest (prescription), ServiceRequest (lab test) and Observation (signed lab result, with interpretation N/A/AA). Doctors only, for patients in their own queue; this clinic's visits only. | Doctors |
| H4 | Every read is audit-logged (`FHIR_PATIENT_EXPORTED`); errors are FHIR OperationOutcome resources. Output checked with an independent FHIR R4 validator: 0 errors. | — |

Diagnoses, prescriptions and lab tests are sent as text until ICD-11/LOINC
coding is added; identifier systems are ACISI's own until DHA confirms the
national ones. System-to-system authentication for the HIE follows DHA's
specification.

## 2026-11-14: Multi-factor login for clinic admins and doctors

After the right staff ID and PIN, clinic admins and doctors enter a 6-digit
code sent by SMS to their own phone (5 minutes, 5 tries, one use). "Remember
this device for 30 days" skips it on that browser; a PIN reset or deactivation
forgets remembered devices. If the SMS can't be sent, nobody gets in. Codes
and device tokens are stored only hashed. Off until `STAFF_MFA_ENABLED=true`
(see the runbook: only once real SMS delivery works). No database change.

## 2026-11-14: DHA fixes: encryption at rest, tamper-proof audit log, inactivity logoff, adults-only signup

One database change, additive (`20261114120000_audit_log_tamper_resistant`);
undo script in `prisma/rollback/`. A new required setting on live servers:
`DATA_ENCRYPTION_KEY` (see the runbook release steps).

| # | What changed | Data it touches | Who |
|---|---|---|---|
| S1 | **Encryption at rest (AES-256-GCM):** diagnoses, prescriptions, reasons for visit, lab notes and results, ID numbers and next-of-kin details are stored encrypted in the database; uploaded files are encrypted on disk. Changed or damaged ciphertext is refused, not shown. The app decrypts only for people allowed to see the data. Names and phone numbers stay unencrypted because they are used to search. `npm run encrypt-existing-data` encrypts what was stored before. | Visits, lab requests and results, patients, pending signups, files | — |
| S2 | **Tamper-proof audit log:** the database refuses any change, deletion or truncation of audit records, and chains every record to the previous one with a SHA-256 hash, so any alteration shows up in `npm run verify-audit-log`. | Audit log (two new columns) | — |
| S3 | **Automatic logoff after 15 minutes without activity** for staff and patients, enforced by the server; the login page says why. Background screen refreshes do not count as activity. The 8-hour (staff) and 6-hour (admin) limits stay. | Sessions | Everyone |
| S4 | **Portal signup is for adults:** date of birth is required and anyone under 18 is refused ("A parent or guardian can check a child in at the clinic"), as the Terms already said. | Pending signups | Patients |

## 2026-11-14: Background jobs no longer fill Redis

Every job queue now keeps only its newest 200 finished jobs (1,000 failed),
deleting older ones as new jobs finish. Before, every finished job was kept:
the once-a-minute payment sweep had stored about 45,000 and filled Redis's
64 MB cap, which stops logins. No database change.

## 2026-11-14: Lab orders

Doctors can request lab tests; the lab enters and signs the results; the
patient is told by SMS to go back to the doctor. One database change, additive
only (`20261114100000_lab_orders`); undo script:
`prisma/rollback/20261114100000_lab_orders.down.sql`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| L1 | **New role: Lab technician.** Signs up with the clinic invite code and accepts the Confidentiality Undertaking like other staff. Sees only the lab queue: the patient's name, ACISI ID, age and sex, the tests requested and the doctor's note for the lab. Never the phone number, diagnosis, prescription, history or billing. | Staff (new role) | Lab technicians |
| L2 | **Front-desk screens now allow front-desk roles only** (receptionist, clinician, admin) instead of refusing only doctors, so any other role is refused by default. Checkout is now front-desk only (doctors could reach it before). | — | All staff |
| L3 | **Lab tests list:** clinic admins add the tests their lab offers, with prices (Settings → Lab tests); tests can be renamed, repriced or stopped. Logged. | New: lab tests (name, price) | Clinic admins |
| L4 | **Request lab tests:** during a consultation the doctor ticks tests, adds an optional note for the lab, and signs with their PIN. The patient leaves the doctor's queue and joins the lab queue ("At the lab" on the front-desk queue). | New: lab orders (tests, who, when, note) | Doctors |
| L5 | **Lab results:** the lab opens a request, enters a result, unit, flag (normal, abnormal, critical) and comment per test, can attach a printout (PDF or photo, filed as a lab report), and signs with their PIN. Every test needs a result or a flag first. | Lab results; patient files | Lab technicians |
| L6 | **Back to the doctor:** signed results send the patient back to the requesting doctor's queue ("Back from lab"); front desk can move them to another doctor with "Change doctor". The doctor sees the results on the consultation page. | Visits (status) | Doctors, front desk |
| L7 | **"Results ready" SMS:** one SMS, "ACISI: Your lab results at <clinic> are ready. Please go back to the doctor." Never the tests or results. Respects "does not want SMS"; counted against the clinic's SMS allowance (`LAB_RESULTS_READY`). | SMS count | Patients |
| L8 | **Billing:** the requested tests and their prices are added to the checkout bill (editable as before). Payment at checkout with everything else. | Bills | Front desk |
| L9 | **Records:** lab results appear on the printed visit record, in the checkout email PDF, in the patient's portal records and downloads (once checked out) and in doctors' visit history. Front desk never sees results on screen. Every request, opening, save, signature and SMS is audit-logged with IDs only. | — | Patients, doctors |

## 2026-11-14: Patient file uploads

Brings the file-upload feature from the October branch onto the current
system, adapted to today's record-sharing rules. One database change, additive
only (`20261114090000_patient_files`); undo script:
`prisma/rollback/20261114090000_patient_files.down.sql`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| F1 | **Upload a file to a patient's record:** JPG, PNG or PDF, up to 20 MB, with a category (X-ray, CT scan, MRI, ultrasound, lab report, previous records, other), the date of the document and an optional note. The type is checked from the file's content, not its name. | New: patient files (category, date, note, type, size; bytes on the server's own disk) | Front desk, admins, doctors, patients |
| F2 | **Photograph a paper file** page by page; the pages are saved as one PDF under "Previous records" (up to 30 photos, 100 MB). | Patient files | Front desk, admins, doctors |
| F3 | **Who sees a file:** the clinic that uploaded it and the patient, always. Other clinics, and the patient's own uploads, only when the patient allows sharing or has given that clinic a records code today (the same rule as visit records). Doctors only for patients in their own queue. Hidden files are only counted. Every upload and view is audit-logged (IDs only). | Audit log | — |
| F4 | **Storage:** files live in a private folder on the ACISI server in Kenya (`/var/lib/acisi/uploads`), under random names, never in a cloud. Uploads are refused when the disk has less than 2 GB free. The nightly encrypted backup includes the files (newest 3 copies). The owner Overview shows file storage and disk use. | — | Owner |
| F5 | **Account deletion** removes the files the patient uploaded themselves; files a clinic uploaded stay with that clinic, like its visit records. | Patient files | Patients, owner |

## 2026-11-03: ODPC statements, part 2

Brings four more statements in the ODPC applications in line with the
system, and clears the critical and high library warnings. One database
change, additive only (`20261103090000_signup_verify_phone_first`); undo
script: `prisma/rollback/20261103090000_signup_verify_phone_first.down.sql`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| D1 | **One SMS at checkout: receipt and visit summary together.** Clinic, visit date, amount paid and method (and any balance), and the prescription. Never the diagnosis or the department. Always one SMS of at most 160 characters: if it doesn't fit, the prescription becomes "Prescription: see your ACISI profile" (then payment codes are dropped, then the clinic name is shortened). Respects "does not want SMS". Sent exactly once (checkout is now a conditional update). A bill paid before checkout no longer sends its own receipt; a bill paid off after checkout still gets a receipt. Counted against the clinic's SMS allowance (`CHECKOUT_SUMMARY`). Logged: `CHECKOUT_SMS_SENT` / `CHECKOUT_SMS_SKIPPED_OPT_OUT`. | Encounters, bills (read); SMS count | Patients, front desk |
| D2 | **Clinic admins can deactivate staff** from Settings → staff list (e.g. someone left). Logs them out everywhere; their name stays on every visit and payment they handled. Not yourself, and not the clinic's last active admin. Audit-logged (`STAFF_DEACTIVATED_BY_ADMIN`). Reactivation is still done by ACISI. | Staff (active flag) | Clinic admins |
| D3 | **Sex at portal signup** (optional; Female / Male / Other / Prefer not to say, as at walk-in). | Patients (sex) | Patients |
| D4 | **Signup: the phone is verified first, then the PIN is chosen.** Step 1 details (no PIN), step 2 the SMS code, step 3 choose the 6-digit PIN; only then is the account created. A one-time token links steps 2 and 3 (stored hashed, 30 minutes). At the clinic, "Finish setup" verifies the phone in person, creates the account without a PIN, and shows a one-time setup code for choosing it (as for walk-ins). | Pending signups (PIN now optional; verified date; token hash and expiry) | Patients, front desk |
| D5 | **Libraries:** express 4.22.3, axios 1.21, bcrypt 6, zod 4, patched axios/joi/lodash under africastalking (npm `overrides`), vite 6.4.5. `npm audit`: 0 critical and 0 high in all four packages; the server's production libraries have no warnings at all. | — | — |

## 2026-10-30: Data-protection alignment (ODPC statements)

Makes the statements in ACISI's ODPC Data Controller and Data Processor
registrations true of the system. Database changes are additive only (new
optional columns, two new tables, new allowed values); no existing data is
changed by the migration. Undo script: `prisma/rollback/20261030090000_odpc_alignment.down.sql`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| C1 | Doctors can only search for and open patients currently in their own department queue (assigned to them or to nobody). Enforced by the server; anything else answers "Patient not found". Doctors are refused on the clinic-wide queue, appointment list and fee confirmation. | Patients, visits, appointments (read) | Doctors |
| C2 | Receptionists, clinicians and clinic admins no longer receive diagnoses. Prescriptions stay visible; checkout shows this visit's prescription. Front desk can **Print visit record** when a patient asks for a paper copy (logged). Each history entry shows which doctor handled it. | Visits (read) | Front desk |
| C3 | Web signup now verifies the phone with a 6-digit SMS code before the account exists. If the SMS fails, the details are kept for 14 days and the clinic's front desk finishes setup after ringing the patient's phone in front of them. Patients without a PIN (walk-ins) can get a one-time setup code at the desk the same way. | New: pending signups (deleted after 14 days); patient phone-verified date and method | Patients, front desk |
| C4 | Records from other clinics are shown automatically only if the patient allows sharing. Otherwise the clinic sees "This patient has not authorised sharing of records from other clinics." and can **Request records**: the patient gives a one-time code from their profile (or SMS) and the clinic sees them until the end of that day. Every view of other clinics' records is logged with clinic, staff member and basis. | New: record access requests; consents | Front desk, doctors (view), patients |
| C5 | Patients can turn sharing on or off in their Account tab; every decision is saved with date, time and source, and listed for them. | Consents | Patients |
| C6 | Wrong PINs are counted per account (not per phone-number format or session). After 5 wrong PINs within 5 minutes the account is locked for 5 minutes ("Too many wrong PINs. Try again in 5 minutes."). One setting: `PIN_LOCKOUT` in `src/config/constants.ts`. A PIN reset unlocks. | Lock counters (Redis, not stored) | Everyone who logs in |
| C7 | Every audit entry now records the clinic. Details hold IDs and statuses only; names, phone numbers, diagnoses and free text are stripped. The actual PIN change, record prints, checkout views and sharing decisions are now logged. | Audit log | — |
| C8 | Application logs no longer contain login tokens, cookies, IP addresses, query strings (search text, phone lookups) or error messages that could echo personal data. The nginx access log drops query strings. | Logs | — |
| C9 | USSD is switched off unless `USSD_ENABLED=true`. The USSD code is unchanged. | — | — |
| C10 | Staff and the clinic admin can give an optional work email. | Staff email (new, optional) | Staff |
| C11 | Optional email at walk-in registration; optional ID document and next of kin at web signup (date of birth, sex, email, ID and next of kin were otherwise already there). | Patients | Front desk, patients |
| C12 | Confirmed appointments get one SMS reminder the day before from 09:00 (clinic, day and time only), respecting "does not want SMS". | Appointment reminder time (new) | Patients |
| C13 | All non-essential SMS, including the check-in fee SMS, respect "does not want SMS". Essential messages (codes, deletion notice) still go. After 3 SMS failures in a row the owner Overview shows a warning. | — | Patients, owner |
| C14 | Clinic checkout M-Pesa prompts no longer store the phone number, and Safaricom's stored reply has phone numbers blanked. Account deletion clears them too. Existing rows: `npm run redact-payment-phones` (preview first, `--apply` to change). | Clinic payments | — |
| C16 | Patients see every visit (no 5-visit limit) and can download all of them as one PDF (logged). | Visits (read) | Patients |
| C17 | Sessions: staff and patients 8 hours, clinic admins 6 hours, owner 2 hours. Admin and server-script PIN resets now log the person out. | Sessions | — |
| C19 | Staff signup and clinic registration require ticking "I have read and agree to the ACISI Confidentiality Undertaking.", which links to the full approved text at acisi.co.ke/confidentiality-undertaking (also in the site footer). Version 2026-10-31: everyone who accepted the earlier placeholder, and all existing staff, are asked once at their next console login. Each acceptance is recorded with version, date and time. | Legal acceptances | Staff |
| C20 | Remote check-in puts the patient in the queue straight away; the ACISI fee is confirmed in the background. An unpaid fee shows on the patient's profile with a Pay button (reminder from day 7). The next remote check-in collects old and new fee in one prompt. From day 14 remote check-in and booking can be restricted until paid (only when `FEE_RESTRICTION_ENABLED=true`; off by default). Walk-ins and records are never affected. The owner site lists unpaid fees (ACISI ID and amounts only). **Resend prompt:** if the M-Pesa prompt doesn't arrive or is missed, the patient's check-in screen has a "Resend prompt" button: up to 3 per check-in, not until the last prompt has had a minute, and Safaricom is asked first in case it was paid after all (logged). ACISI's till number is never shown to patients. **Owner warning:** after 3 prompts in a row fail or time out (prompt not sent, phone unreachable, prompt expired, no answer within the hour), the owner Overview shows "M-Pesa prompts are failing – check Daraja/Safaricom" with the time of the last successful payment; a patient cancelling, having too little balance or a wrong PIN does not count. Migration `20261101090000_checkin_prompt_resends`. | Check-ins (new fee fields, resend count), patient restriction date | Patients, owner |
| C24 | SMS sent to patients on each clinic's behalf (receipts, appointment reminders, walk-in invitations) are counted per calendar month, Kenya time, in billed SMS parts. Security codes (PIN reset, phone verification, setup and record codes), the deletion notice and the ACISI check-in fee SMS are not counted, nor are failed sends. Each clinic has a plan (Starter 500, Clinic 1,500, Clinic Plus 4,000 SMS a month); existing clinics start on Starter. The owner sees this month and last month against the allowance, with the number over and the extra charge at KES 2 each, and can change a clinic's plan or allowance (logged). Clinic admins do not see it. Migration `20261031090000_clinic_sms_usage`; undo script in `prisma/rollback/`. | New: clinic plan and allowance; SMS count (clinic, purpose, parts and time only: no number or text) | Owner |

| M-Pesa | **Buy Goods till:** with `MPESA_TILL_NUMBER` set, ACISI's check-in prompts go as Buy Goods (`CustomerBuyGoodsOnline`): the store number (`MPESA_SHORTCODE`) in BusinessShortCode, the password and the status check; the till in PartyB. Unset, prompts stay Paybill. The till is never shown to patients. **Callbacks are confirmed:** a "paid" callback marks a check-in fee PAID only once Safaricom's status query says the same; a contradicted callback is logged (`CHECK_IN_CALLBACK_NOT_CONFIRMED`) and not paid; one Safaricom can't confirm yet is settled by the next status check (receipt kept). **Clinic checkout prompts** (sandbox only) are switched off whenever `MPESA_ENV=production`. | Check-in payments | — |

| M-Pesa (live checks) | With `MPESA_ENV=production` the app will not start unless `MPESA_TILL_NUMBER` is set (Buy Goods only, never Paybill), differs from `MPESA_SHORTCODE`, `MPESA_SHORTCODE` is not Safaricom's sandbox code, `MPESA_CALLBACK_URL` is https, and `CHECKIN_FEE_AMOUNT_KES` is at least 50. Sandbox is unchanged. | Settings only | — |

SMS changes: the visit summary SMS is no longer sent, and the check-in fee
SMS is shortened to two lines (one SMS).

Also: security headers in `deploy/nginx/acisi.conf` (Content-Security-Policy,
X-Frame-Options, Permissions-Policy, HSTS with includeSubDomains), and
Express no longer announces itself.
