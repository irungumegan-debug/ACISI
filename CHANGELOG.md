# Changelog

Plain-language record of what changed in ACISI, which data each change
touches, and who can use it. Newest first.

## 2026-11-21: Public health alerts on screen, IHR flag

No database change.

| What | Who |
|---|---|
| **On-screen alert on every page** while an immediately reportable case (doctors) or public health event (doctors, clinic admins) hasn't been marked reported to the Sub-County: "Report within 24 hours", with a link to Disease surveillance. Works without SMS (the SMS reminders still go once real SMS is live). | Doctors, clinic admins |
| **IHR flag** (International Health Regulations 2005, Annex 2) on the notifiable disease list: always notifiable internationally (smallpox, wild polio/AFP, new influenza subtype, SARS) or to be assessed (cholera, plague, yellow fever, viral haemorrhagic fevers, dengue, Rift Valley fever, meningococcal disease, MERS, any event of international concern). Shown when the doctor signs and on Disease surveillance: report immediately; the Sub-County passes it to the national IHR focal point. | Doctors |

## 2026-11-21: Residence, family history, dispensing

One database change, additive (`20261121130000_residence_family_history_dispensing`:
empty columns on patients and prescription items); undo script in `prisma/rollback/`.

| What | Data | Who |
|---|---|---|
| Patient page and walk-in: **residence** (county, sub-county, ward, village/estate). In FHIR as the Patient's address. Wiped on account deletion. | Patients: `subCounty`, `ward`, `village` (county existed) | Front desk; patients on their own page |
| Consultation page: **Family history** note (who had what). | Patients: `familyHistory`, encrypted at rest | Doctors |
| Checkout page: **Dispensing**. Each prescribed medicine: "Given" (quantity, default the prescribed amount) or "Buying elsewhere"; recording again corrects it. In FHIR and the Shared Health Record as `MedicationDispense`. | Prescription items: dispense status, quantity, when, by whom | Front desk |

Audit log: `FAMILY_HISTORY_UPDATED` / `_CLEARED`, `MEDICINE_DISPENSED`, `MEDICINE_NOT_DISPENSED`.

## 2026-11-21: Fuller clinical summary (visit record) and plan / follow-up

One database change, additive (`20261121120000_care_plan`: one empty column
on encounters); undo script in `prisma/rollback/`.

| What | Data | Who |
|---|---|---|
| Consultation form: **Plan / follow-up** (optional), e.g. "Review in 2 weeks with home BP readings". Shown on the signing summary. | Encounter `carePlan`, encrypted at rest | Doctors |
| The visit record (printed, downloaded by the patient, emailed) now also has: **date of birth, sex and ID document**; **vital signs**; **other current medicines** (still running from earlier visits at the same clinic); **plan / follow-up**; other orders. Dates are day-first, Kenya time. | | |
| FHIR: the plan as a `CarePlan` in `Patient/$everything` (the national Shared Health Record does not take CarePlans). | | |

## 2026-11-21: Quality measures

No database change.

| What | Who |
|---|---|
| Routine reports page: **Quality measures** for the chosen month, quarter or year, each with its count and definition: visits with a coded diagnosis; visits with vital signs; hypertension visits with BP measured; malaria diagnoses confirmed by a test (WHO "test before treat"); diabetes visits with blood sugar tested; children 6-59 months screened with MUAC; median wait to see the doctor; median lab turnaround. "n/a" when nothing to measure. **CSV** download. Counts only, no names. | Doctors, clinic admins |

Audit log: `QUALITY_MEASURES_DOWNLOADED`.

## 2026-11-21: Critical lab result warnings

No database change.

| What | Who |
|---|---|
| When the lab signs a result flagged **Critical**: a red **"Critical result"** badge on that patient in the doctor's queue, and a red **"Critical lab result: review now"** box at the top of the lab results on the consultation page, naming the test and value. | Doctors |
| The doctor who requested the test also gets an SMS ("a CRITICAL lab result is ready for one of your patients at <clinic>"), with no name, test or result in it. Works once real SMS is live; the on-screen warnings work now. | Doctors |

Audit log: `LAB_CRITICAL_RESULT_ALERT` (count and whether the SMS went).

## 2026-11-21: Problem list

One database change, additive (`20261121110000_problem_list`: two new tables);
undo script in `prisma/rollback/`.

| What | Data | Who |
|---|---|---|
| Consultation page: **Problem list**, the patient's long-term or important conditions (hypertension, diabetes, asthma...), separate from a visit's diagnoses. Add from the ICD-11 list with an optional note and "since" date; mark **resolved**, **active again**, change the note, or mark **entered in error**. No active duplicates. | New tables `patient_problems` (condition title and note encrypted at rest) and `patient_problem_changes` | Doctors |
| **History** of each problem (who changed what, when). Nothing is ever deleted. | | |
| Other clinics see it on the same rule as allergies (patient's sharing consent or a records code used today). | | |
| In FHIR as `Condition` (category problem-list-item, ICD-11), and sent with each visit to the national Shared Health Record. | | |

Audit log: `PROBLEM_ADDED`, `PROBLEM_RESOLVED`, `PROBLEM_REACTIVATED`, `PROBLEM_NOTE_CHANGED`, `PROBLEM_ENTERED_IN_ERROR`.

## 2026-11-21: Vital signs, BMI and warnings

One database change, additive (`20261121100000_vital_signs`: a new table);
undo script in `prisma/rollback/`.

| What | Data | Who |
|---|---|---|
| **Vital signs** on the consultation page, and "Vitals" on each waiting patient in the queue (triage): BP, pulse, breathing rate, temperature, oxygen, weight, height, MUAC. Only what was measured; impossible numbers refused. Never edited: a new set corrects an old one. | New table `vital_signs` | Front desk, doctors |
| **BMI** worked out from weight and height. **Weight over time** chart and earlier readings at this clinic. | | |
| **Warnings**, adjusted for the patient's age: raised or very high BP (adults), low BP, fever and hypothermia, low oxygen, fast breathing (WHO IMCI cut-offs for under-5s), pulse out of range for age, MUAC malnutrition (WHO, 6-59 months), BMI categories (WHO, adults). They prompt; they never decide. | | |
| On the visit record ("Vital signs"), in FHIR as vital-signs Observations with **LOINC** codes and UCUM units, and in what is sent to the national Shared Health Record. | | |

Audit log: `VITAL_SIGNS_RECORDED` (which fields and how many warnings, never the values).

## 2026-11-21: Radiology, therapy and other orders

One database change, additive (`20261121090000_service_orders`: a new table);
undo script in `prisma/rollback/`.

| What | Data | Who |
|---|---|---|
| Consultation page: **Other orders**. Radiology/imaging, physiotherapy, occupational therapy, nutrition/dietetics, social work, counselling: what is ordered, optional reason, urgent. Withdrawn before signing = kept, marked cancelled. | New table `service_orders`; what is ordered and the reason encrypted at rest | Doctors |
| Checkout page: **Orders to arrange**, each marked "Done / referred" or "Not needed". | | Front desk |
| On the printed and downloaded visit record ("Other orders"), in FHIR (`ServiceRequest`, category coded with SNOMED CT) and in what is sent to the national Shared Health Record. | | |

Audit log: `SERVICE_ORDER_CREATED`, `SERVICE_ORDER_DONE`, `SERVICE_ORDER_CANCELLED` (type only, never the text).

## 2026-11-20: National Shared Health Record (consent, sending visits, reading, closing)

One database change, additive (`20261120180000_hie_visits`: a new table);
undo script in `prisma/rollback/`. **Off** with the rest of the HIE until
DHA's credentials are in place; the panels stay hidden until then.

| What | Data | Who |
|---|---|---|
| **Consent per visit.** "Ask the patient for consent" on the consultation page (doctor) and the checkout page (front desk). DHA texts the patient a code; they read it out and staff enter it. "Send the code again" and "Patient says no" (the refusal is recorded with DHA and in ACISI's audit log). If the patient already has an open HIE visit at the clinic it's reused, no new code. | New table `hie_visits`: DHA's consent and visit ids, status, the consent token (encrypted) | Front desk, doctors |
| **Emergency consent** (doctors only) for a patient who can't consent, with a short reason sent to DHA; approved at once. | | Doctors |
| **Sending.** At checkout, a consented visit is queued for the national Shared Health Record: ICD-11 diagnoses, prescriptions (DHA codes), lab requests and results, the clinic's allergy records. National identifiers only (Client Registry ID, facility code, practitioner ID); no Patient resource. Retried 5 times over ~15 minutes if DHA is down; never blocks checkout. Status on the checkout page; "Try sending again" if it failed. | | Front desk |
| **Reading.** "Show records from other facilities" on the consultation page: the patient's visits, diagnoses, medicines, allergies, results and immunisations from the national record. Needs consent and the doctor's verified registration. Shown only, never saved in ACISI. | | Doctors |
| **Closing.** "Close the HIE visit" on the checkout page once the visit is sent; DHA may text the patient a closing code. The consent token is deleted on closing. | | Front desk |

Audit log: `HIE_CONSENT_REQUESTED`, `_APPROVED`, `_REFUSED`, `_EMERGENCY`,
`_CODE_RESENT`, `_CODE_WRONG`, `_REUSED_OPEN_VISIT`, `HIE_SHR_VISIT_SENT`,
`_SEND_FAILED`, `_RESEND`, `HIE_SHR_RECORDS_VIEWED` (count only),
`HIE_VISIT_CLOSE_CODE_SENT`, `HIE_VISIT_CLOSED`.
Not yet: consent through a parent or guardian for children (DHA's
"dependant" consent needs the guardian's Client Registry ID; ACISI doesn't
record guardians as separate people yet).

## 2026-11-20: National HIE registries (facility, health workers, patients)

One database change, additive (`20261120150000_hie_registries`: empty
columns on clinics, staff and patients); undo script in `prisma/rollback/`.
**Off** until DHA issues ACISI's HIE credentials (`HIE_ENABLED`, runbook
"Connecting to the national HIE"); until then the pages say "not connected yet".

| What | Data | Who |
|---|---|---|
| **National HIE** page. Clinic admin finds the clinic in DHA's Facility Registry (by name, MFL code or FR code) and saves its FR code; every HIE call then carries it. | Clinic: FR code, official name | Clinic admins |
| Doctors and clinical officers enter their regulator (KMPDC, COC, NCK, PPB) and registration number once; ACISI looks them up in the Health Worker Registry and keeps their practitioner ID (PUID), registered name and licence end date. Expired licence shown in red. | Staff: regulator, registration number, PUID, name, licence end | Doctors, clinical officers |
| Patient page: "Look up in the national Client Registry" using the ID document on file (national ID, alien ID, birth certificate; not passports). A clear name and date-of-birth match saves the CR ID; otherwise both sets of details are shown side by side to compare, and it's saved only if staff confirm. A changed ID document makes the saved CR ID stop counting. | Patient: CR ID (encrypted), when it was checked | Front desk, clinic admins, clinicians |
| Only the CR ID, names, date of birth and sex are read from the Client Registry's answer; everything else it returns (income, employer, KRA PIN...) is dropped. | | |

Audit log: `HIE_FACILITY_SET`, `HIE_PRACTITIONER_VERIFIED`,
`HIE_CLIENT_REGISTRY_LOOKUP` (result only), `HIE_CLIENT_REGISTRY_CONFIRMED`.
Next (after credentials): Shared Health Record consent, sending visits,
reading records from other facilities (`docs/compliance/HIE-integration-plan.md`).

## 2026-11-20: Multi-factor login with an authenticator app

One database change, additive (`20261120120000_staff_authenticator`: two
empty columns on staff); undo script in `prisma/rollback/`. New dependency:
`qrcode` (draws the setup QR code on the server).

| What | Data | Who |
|---|---|---|
| After the PIN, clinic admins and doctors enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator...). **Needs no SMS**, so it can be switched on now. | Per person: the app's secret, AES-256-GCM encrypted | Admins, doctors |
| **First login after switch-on:** a QR code to scan, then the first code from the app. Nothing is saved until that code is right. | | Admins, doctors |
| "Remember this device for 30 days" as before. A PIN reset, deactivation or authenticator reset forgets remembered devices. | | |
| 5 wrong codes lock the account for 5 minutes (counted separately from PINs: a correct PIN does not reset it). A code can't be used twice. | | |
| **Lost phone:** Settings → Staff → "Reset authenticator app" (clinic admin), or `npm run reset-staff-authenticator -- <staff ID>` on the server (e.g. the only admin lost their phone). Logs the person out; they scan a new QR code at the next login. Logged. | | Clinic admins, ACISI |
| SMS login codes remain available only with `STAFF_MFA_SMS_ENABLED=true` (after real SMS works), for people who haven't set up an app. | | |

Audit log: `STAFF_AUTHENTICATOR_SET_UP`, `STAFF_AUTHENTICATOR_RESET`,
`STAFF_LOGIN_CODE_WRONG`; `STAFF_LOGIN_CODE_VERIFIED` now records the method.
Front desk and lab technicians are not affected.

## 2026-11-17: Front-desk setup code always accepted

No database change. A patient holding a setup code from the front desk
(phone confirmed in person because no SMS arrived) could be told "Invalid or
expired code" if they had pressed "Forgot PIN" after the code was made: only
the newest code was checked, and that was the SMS one. Now the newest code of
each kind is checked; wrong guesses still count against the limit.

## 2026-11-16: Owner password minimum 6 characters

No database change. The owner site password may now be 6 characters or more
(was 12), the same length as staff PINs, at the owner's request. Wrong
passwords still lock the account for 5 minutes. Set or reset it on the server
with `npm run create-owner` (runbook / README).

## 2026-11-14: Routine reports and public health events

One database change, additive (`20261114230000_public_health_events`); undo
script in `prisma/rollback/`. Follows the **Kenya IDSR Technical Guidelines,
3rd edition (MOH, 2022)**: event-based surveillance, Table 5 (immediately
reportable events) and the monthly reporting table.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| R1 | **Public health events** (Disease surveillance page): record what a diagnosis can't show: a cluster of unwell people or of deaths, sick or dead animals, an adverse event after immunization (AEFI), a SARI cluster, a maternal, neonatal or malaria death, or a food-borne, chemical or unknown event. Date, people affected and deaths (each with "under 5"), place, description. **Counts only, never patient names.** | New: events (description, place and report note encrypted at rest) | Doctors, clinic admins |
| R2 | **Immediate events alert** the clinic's admins and doctors by SMS ("A public health event was recorded at {clinic}. Report within 24h…", no details), show "Report within 24 hours" and a red menu badge until someone marks them reported to the Sub-County (with an optional note). Neonatal and malaria deaths are weekly. All audit-logged (IDs only). | Events | Doctors, clinic admins |
| R3 | **Weekly MOH 505 summary** now fills the rows that used to say "count by hand" from recorded events (AEFI, SARI, maternal, neonatal and malaria deaths, events of concern) and adds a **Deaths** column (under 5 / 5 and over in the CSV). | — | Doctors, clinic admins |
| R4 | **Routine reports** (new menu item): monthly, quarterly or annual. Visits (walk-in / remote, completed), patients seen (new / returning), by sex, age group and department, top 10 ICD-11 diagnoses, lab requests and abnormal/critical results, prescriptions and top medicines, notifiable cases, public health events, and the **IDSR monthly reportable diseases** table (diabetes, hypertension and HIV new cases, cancers, malaria, malnutrition and pneumonia under 5, STIs, TB and leprosy quarterly…) split under 5 / 5 and over. Road traffic injuries are counted by hand (a code doesn't say how an injury happened). Download as CSV (audit-logged). Counts only, no names. | — (reads visits) | Doctors, clinic admins |

## 2026-11-14: Live place in the queue for patients

One database change, additive (`20261114220000_queue_nearly_next_sms`); undo
script in `prisma/rollback/`.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| Q1 | **"My visit today" card** at the top of the patient portal, for any visit in progress however the patient checked in (front desk walk-in, portal, USSD): "You're number 3", "You're next", "With the doctor", "At the lab", "Back from the lab", "Ready to pay". Refreshes every 20 seconds while the page is open, so the number drops as each person ahead is called in. | — (reads visits) | Patients |
| Q2 | **Remote check-in SMS** now ends "You are number 4 in the queue." when the patient is already waiting. Still one SMS. | — | Patients |
| Q3 | **"You're nearly next" SMS**, checked every minute: once per visit, to anyone with 2 or fewer people ahead who has waited at least 10 minutes (walk-ins included, so they can step out). "ACISI: 2 people are ahead of you at {clinic}. Please make your way there." Never the department or anything medical; respects "does not want SMS"; counted against the clinic's SMS allowance; audit-logged (IDs only). | Visits: new `nearlyNextSmsAt` | Patients |
| Q4 | The queue number is calculated the same way everywhere (portal, SMS): waiting patients at the same clinic and department who checked in earlier and can go to the same doctor. | — | — |

## 2026-11-14: Structured prescriptions and allergy warning

One database change, additive (`20261114200000_prescription_items`); undo
script in `prisma/rollback/`. Shaped after the Digital Health Agency's
**Kenya ePrescription FHIR guide** (ke.fhir.eprescription 0.1.0, CC-BY-4.0):
medicines, routes, units and instructions use DHA's own code lists, bundled
in `src/assets/dha/` (medicine names from the Pharmacy and Poisons Board).

| # | What changed | Data it touches | Who |
|---|---|---|---|
| P1 | **One card per medicine:** search DHA's Kenya medicines list (3,019 products with strength and form, e.g. GE10177 Paracetamol 500 mg Oral Tablet), or type a medicine not on the list. Dose and unit, how often, for how many days, route (suggested from the form), quantity to give (worked out automatically), DHA's instructions (e.g. "Take with or after food") and a note. Optional advice for the patient. | New: prescription lines (medicine name, note and override reason encrypted at rest) | Doctors |
| P2 | **Allergy warning:** while the doctor writes, each medicine is checked against the patient's recorded allergies: the same medicine or ingredient, brand names (Augmentin, Septrin...) and drug groups (penicillins, cephalosporins, sulfonamides, NSAIDs, fluoroquinolones, macrolides...). A clashing medicine can only be signed with the doctor's reason; the server checks again at signing. Overrides are audit-logged (IDs only). Not checked: cross-reactions between groups, allergies hidden at other clinics. | Prescription lines | Doctors |
| P3 | **Current medicines and medication history** on the consultation page, from the visits the doctor may see (same sharing rule as visit history), with any allergy override shown. | — | Doctors |
| P4 | The visit's prescription text (SMS, visit record PDF, portal, checkout) is now written from the lines, one medicine per line. Older visits are unchanged. | — | Patients, front desk |
| P5 | **FHIR:** one MedicationRequest per medicine, coded with DHA's systems (Generic Products, route, unit, additional instruction), structured timing, dose and quantity to dispense. Independent FHIR R4 validator: 0 errors. | — | — |

## 2026-11-14: Notifiable disease alerts and weekly summary (IDSR)

One database change, additive (`20261114180000_notifiable_disease_cases`);
undo script in `prisma/rollback/`. The disease list follows the **Kenya IDSR
Technical Guidelines, 3rd edition (MOH, 2022)**: Table 5 (immediately
reportable) and the rows of the MOH 505 weekly form (2020 edition), as
downloaded from nphi.go.ke on 14 Nov 2026.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| N1 | **Automatic detection:** when a doctor signs a visit with an ICD-11 code on the notifiable list (`src/services/notifiableDiseases.ts`: the 27 immediately reportable entries of Table 5 and the weekly-only MOH 505 rows, each mapped to WHO ICD-11 codes), a case is recorded in the same save. Events, deaths and clusters (AEFI, SARI, maternal and neonatal deaths, malaria deaths, public health events) have no diagnosis code: ACISI lists them as "count by hand". | New: notifiable disease cases (patient, disease, code, date; report note encrypted at rest) | Doctors |
| N2 | **Alert on screen:** after signing, the doctor sees the disease, its code and "report within 24 hours" (immediate: to the Sub-County Disease Surveillance Coordinator, form MOH 502, without waiting for lab confirmation) or "counted in the weekly report". | — | Doctors |
| N3 | **SMS reminder** for immediately reportable diseases to the clinic's active admins and doctors: "An immediately notifiable disease was diagnosed at {clinic}. Report within 24h…". Names neither the patient nor the disease. Not counted against the clinic's SMS allowance. | Staff phone numbers | Admins, doctors |
| N4 | **Disease surveillance page:** doctors see the clinic's cases (patient, ACISI ID, age, sex, disease, code) and mark immediately reportable ones as reported, with an optional note; a red badge in the menu counts those not yet reported. | Notifiable disease cases | Doctors |
| N5 | **Weekly summary** (Monday to Sunday, Kenya time) in MOH 505 row order: cases under 5 / 5 and over / age unknown, and a CSV download. Counts only, no names. ACISI doesn't record deaths, so the form's death columns are filled by hand. | — | Doctors, clinic admins |
| N6 | Audit: `NOTIFIABLE_DISEASE_DIAGNOSED`, `NOTIFIABLE_DISEASE_ALERT_SENT`, `NOTIFIABLE_CASE_REPORTED`, `IDSR_WEEKLY_SUMMARY_DOWNLOADED` (IDs and disease IDs only). | — | — |

Not yet: sending reports to the Ministry automatically (KHIS/DHIS2 or the
HIE). That waits for DHA/MOH to say where and how.

## 2026-11-14: ICD-11 coded diagnoses

One database change, additive (`20261114160000_icd11_diagnosis_codes`); undo
script in `prisma/rollback/`. Uses WHO's ICD-11 for Mortality and Morbidity
Statistics (MMS), release 2025-01: 17,231 diagnosis codes with WHO's official
titles, unmodified (ICD-11 © World Health Organization, licensed CC BY-ND 3.0
IGO). The list ships with ACISI; no outside service is called.

| # | What changed | Data it touches | Who |
|---|---|---|---|
| D1 | **Coded diagnosis:** the consultation form has an ICD-11 search (by words or code). The doctor must pick 1 to 5 codes before signing. The server checks every code against WHO's list and stores WHO's title, never text typed in the browser. | Visits: new `diagnosisCodes` (encrypted at rest) | Doctors |
| D2 | **Clinical notes:** the free-text box becomes optional "Clinical notes" alongside the codes. Older visits keep their text diagnosis. | Visits (existing `diagnosis`) | Doctors |
| D3 | **Where codes show:** doctor's visit history, the patient portal, the printed/emailed visit record (PDF). Front desk still never sees a diagnosis on screen. | — | Doctors, patients |
| D4 | **FHIR:** one Condition per code, coded with system `http://id.who.int/icd/release/11/mms`; notes in `Condition.note`. Older visits are sent as text only. Checked with an independent FHIR R4 validator: 0 errors. | — | — |
| D5 | **Build fix:** the server build copied `src/assets` into `dist/assets/assets/` on every build after the first, so new files there were never found. Now copies the contents. | — | — |

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

Prescriptions and lab tests are sent as text until coded terminologies for
them are added (diagnoses: ICD-11 since the entry above); identifier systems are ACISI's own until DHA confirms the
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
