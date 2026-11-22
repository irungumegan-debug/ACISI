# DHA self-attestation: final answers (20 Nov 2026)

Draft reference **DHS-1793019691629-GXVFAJJTJ** (DHA portal, acisihelp@gmail.com).
Status: **ready to submit without DHA's answers.** Our questions of 16 Nov got
no reply (the copy to interoperability@dha.go.ke bounced: the address does not
exist; the copy to raymondbett@dha.go.ke was delivered, no answer). The open
questions are declared below as known gaps with a plan, which is what the
self-attestation's gap section is for. They can be closed after certification.

Every answer was checked against the code on 20 Nov 2026 (branch after PR #66).
Rule: **tick only what is live on acisi.co.ke today.** "Built, not switched on"
and "planned" go in the gap section, never as a tick.

---

## 1. Organisation and solution

| Question | Answer |
|---|---|
| Solution name | ACISI |
| Type | Clinic management / EMR (outpatient), USSD-first, web console, patient portal |
| Users | Small outpatient clinics in Kenya: front desk, doctors, clinical officers, lab technicians, clinic admins; patients (portal and USSD) |
| Hosting | Server in Kenya (HostAfrica), PostgreSQL; data stays in Kenya |
| Data Protection Officer | Megan Irungu (founder) |
| ODPC registration | Yes (data controller/processor record; DPIA 13 Nov 2026, v1.3) |

## 2. Classification

Outpatient EMR / clinic management system handling identifiable health data
(Patient, visits, diagnoses, prescriptions, lab results, files). Not a medical
device; no automated diagnosis.

## 3. Clinical functions

| Function | Answer | Where in the code |
|---|---|---|
| Patient registration, unique ID, search | Yes | `src/services/patientService.ts` |
| Check-in / queue | Yes (web, USSD planned Dec 2026–2027) | |
| Consultation notes, signed with PIN, locked after signing | Yes | |
| **Coded diagnoses (ICD-11)** | **Yes**: WHO ICD-11 MMS 2025-01, doctors must pick 1–5 codes | `src/assets/icd11/` |
| **ePrescription, structured, DHA codes** | **Yes**: DHA ePrescription IG 0.1.0 code lists (medicines, route, unit, instructions) | `src/assets/dha/` |
| Allergy recording and warning at prescribing | Yes (override needs a reason, kept encrypted) | |
| Lab requests and results, signed | Yes | |
| Patient files (scans, photos of paper records) | Yes, encrypted on disk | `src/services/fileStorageService.ts` |
| Billing / payments | Check-in fee: **live M-Pesa** (STK push, confirmed 20 Nov 2026). Clinic checkout: cash and M-Pesa recorded; checkout STK push not yet live | `src/mpesa/` |

## 4. Reporting

| Question | Answer |
|---|---|
| Notifiable disease alerts (IDSR 3rd ed. 2022, Table 5) | **Yes**: immediate-case alert to the clinic's doctors (MOH 502 details) |
| Weekly IDSR summary (MOH 505) | **Yes**: produced on screen and as CSV, Monday–Sunday, under 5 / 5 and over |
| Public health events (event-based surveillance, MOH 505 event and death rows) | **Yes** |
| Routine reports (monthly, quarterly, annual; IDSR monthly table) | **Yes**, no patient names |
| **Automatic submission to KHIS / eIDSR / HIE** | **No** (gap G3). Reports are produced for the clinic to submit to the Sub-County |

## 5. Security and privacy

| Control | Tick? | Evidence |
|---|---|---|
| Unique personal login per user, role-based access | ✅ | 5 roles (front desk, clinician, doctor, admin, lab technician); doctors see only their department queue; lab sees only lab requests |
| Passwords/PINs stored hashed | ✅ | bcrypt (`src/services/staffService.ts`) |
| Account lockout | ✅ | 5 wrong PINs → 5-minute lock (`src/services/pinLockout.ts`) |
| Automatic logoff on inactivity | ✅ | 15 minutes (`IDLE_LOGOFF_SECONDS`, `src/config/constants.ts`); sessions also expire (staff 8 h, admin 6 h, owner 2 h) |
| **Multi-Factor Authentication** | ⏳ **tick once live** | Authenticator app (TOTP) for admins and doctors, built 20 Nov 2026, no SMS needed. Tick only after the release is installed, `STAFF_MFA_ENABLED=true` is set and checklist section F passes; until then gap G1 |
| Encryption in transit | ✅ | HTTPS only, TLS 1.2/1.3, HSTS |
| Encryption at rest | ✅ | AES-256-GCM for health fields, ID numbers, next of kin (`src/utils/fieldCrypto.ts`) and uploaded files; key offline |
| Audit trail | ✅ | Logins, record views, exports and changes logged; append-only (database refuses update/delete) and hash-chained; `npm run verify-audit-log`. Checked 22 Nov: saving a consultation is recorded on the visit (doctor, time) but not as its own audit row; logout and refused (403) requests are not logged. See `dha-phase3/` Audit Trail Specification |
| Consent for sharing between clinics | ✅ | Off by default; patient consent or same-day code; logged |
| Minors | ✅ | Portal signup refuses under-18s; children registered at the clinic with a guardian |
| Backups and restore test | ✅ | Nightly encrypted backups (age): database 14 days, uploaded files last 3 copies; restore test **date: fill in from checklist H2** |
| Off-site backup | ❌ | Gap G5 |
| Breach procedure | ✅ | Clinic within 48 h, ODPC within 72 h, affected patients when at real risk (add DHA notification to the procedure: G9) |
| DPIA | ✅ | `docs/compliance/DPIA-2026-11-13.md` |
| Server hardening | ✅ | SSH key only, no root login, firewall (22/80/443), fail2ban, automatic security updates |

## 6. Interoperability

| Question | Answer |
|---|---|
| Standard | **HL7 FHIR R4** (`/fhir/r4`, CapabilityStatement at `/fhir/r4/metadata`) |
| Resources | Patient, Organization, Practitioner, Encounter, Condition (ICD-11), AllergyIntolerance, MedicationRequest (DHA codes), ServiceRequest, Observation; `Patient/$everything` Bundle |
| Guides followed | Kenya Core 1.0.0, Patient Summary 0.1.0, ePrescription 0.1.0 (validated with the FHIR R4 validator: 0 errors) |
| Access | Logged-in doctors only; front desk and anonymous requests refused |
| **Connected to the national HIE / Client Registry (SHR, CR, Facility Registry)** | **No** (gap G2): waiting for DHA's HIE specification and test credentials |
| National identifiers | ACISI's own identifier systems until DHA gives the national ones (G2) |

## 7. Self-assessment: known gaps and plan

| # | Gap | Plan | Target |
|---|---|---|---|
| G1 | MFA built but not yet switched on | Authenticator-app login built 20 Nov 2026: install and switch on (runbook) | Nov 2026 |
| G2 | Not yet connected to the HIE (national identifiers, profiles, system auth) | FHIR R4 interface is built; adapt and connect once DHA issues HIE sandbox credentials and spec (requested 16 Nov 2026) | Within 3 months of DHA providing the spec |
| G3 | Reports not sent automatically to KHIS/eIDSR | Clinics submit the generated MOH 505 / monthly report; automate once DHA/MOH name the route | With G2 |
| G4 | Use of the Pharmacy and Poisons Board medicine list (DHA ePrescription IG) "subject to separate terms" | Asked DHA 16 Nov 2026; will follow DHA's terms or remove the copy | On DHA's answer |
| G5 | Backup copy is on the same server | Off-server copy kept in Kenya | Before onboarding more clinics |
| G6 | No external uptime alert | Add one on `/healthz` | Dec 2026 |
| G7 | Automatic deletion at end of retention | Build | Q2 2027 |
| G8 | Card payments and live M-Pesa at clinic checkout | Check-in fee live on M-Pesa since 20 Nov 2026; checkout prompts and cards next | Dec 2026 |
| G9 | Breach procedure does not yet name DHA | Add DHA notification (48 h) to the breach procedure | Dec 2026 |

---

## Before clicking Submit (owner)

1. Run the manual test checklist (`docs/testing/manual-test-checklist.md`),
   at least sections 0, O and E, and H2 for the restore-test date.
2. In the portal, enter the answers above. Tick MFA only once it is live (section 5).
   Paste section 7 into the gaps / self-assessment field.
3. Documents the regulations ask for with the application (Form HMIS 4):
   system manual, requirements specification, Cyber Security Assessment
   Report, DPIA. Upload what the portal asks for; the DPIA is ready.
4. Pay and submit. Write the submission date and receipt number here:
   ______________
5. Tell Claude, so `CLAUDE.md` and the checklist can be updated.

---

## Update 21 Nov 2026: what becomes tickable once this release is installed

Built 20-21 Nov 2026 (see `CHANGELOG.md`). **Tick only after the update is
installed on acisi.co.ke and you have seen each feature work** (test
checklist). Not yet live on the day of writing.

### Section 3: Functionality

| Component | Tick | Feature in ACISI |
|---|---|---|
| Demographics | Residence/Address: **leave unticked** | Not collected: not in the Privacy Notice, DPIA or ODPC registration (owner, 21 Nov 2026) |
| CPOE | + Medications | Structured prescriptions (already live) |
| CPOE | + Dispensing | Checkout: "Given" (quantity) / "Buying elsewhere" |
| CPOE | + Radiology, Physiotherapy, Occupational Therapy, Nutrition/Dietetics, Social Work, Counselling | Consultation: Other orders |
| CPOE | + Family History | Consultation: Family history |
| CPOE | + Vital Signs, BMI/Growth Charts | Vital signs (triage or doctor), BMI, weight-over-time chart, MUAC for children |
| CPOE | MCH Encounter: **leave unticked** | Not built |
| Problem list | + Can Update Problems | Problem list: resolve, active again, note, entered in error, history |
| Problem list | KNHTS: **leave unticked** | Needs the HIE Terminology Service (DHA credentials) |
| Medication management | + Active Medication List, Medication History | Already live (doctor's page) |
| Medication management | HPT Registry / HPT Allergy Integration: **leave unticked** | Not integrated |
| Clinical decision support | **Switch on**; + Uses Allergy List, Uses Demographics, Uses Lab Results, Uses Vital Signs. **Uses Problem List: leave unticked** (checked 22 Nov: no warning reads the problem list; the notifiable-disease alert uses the visit's diagnoses) | Allergy warning at prescribing; notifiable-disease alert from diagnoses; age-adjusted vital-sign warnings; critical lab result alerts |
| Clinical decision support | Evidence-Based Interventions: judgement call | Warnings use WHO cut-offs (IMCI, MUAC, BMI); no treatment guidance. Leave unticked unless DHA's definition is just "evidence-based alerts" |
| Clinical decision support | Uses HPT Registry: **leave unticked** | |
| Clinical summary | + Includes Biodata, Includes Medications, Includes Care Plan | Visit record: date of birth, sex, ID; other current medicines; plan / follow-up |
| Clinical summary | Kenya HIE Exchangeable: **after DHA connection** | |
| Electronic prescribing | + Includes Diagnostic Tests, Includes Medication Lists. **Includes Problem List: leave unticked** (checked 22 Nov: the visit record carries the visit's diagnoses, not the problem list) | The visit record with the prescription carries diagnoses, lab results and current medicines |
| Electronic prescribing | Electronic Transmission: **after DHA connection** | |
| Quality measures | **Switch on**; + Capture, Calculate, Export | Routine reports → Quality measures, CSV |
| Quality measures | Import, Electronic Submission: **leave unticked** | |

### Section 4: Reporting

| Component | Tick | Feature |
|---|---|---|
| Routine Reporting | **Switch on**; Monthly, Quarterly, Annual | Already live |
| Public Health Events | **Switch on**; Event Detection (live), Alert Mechanism (on-screen banner, new) | |
| Events of International Concern | **Switch on**; IHR Compliant | IHR flag on notifiable diseases |
| Immediate | Real-Time Reporting: **leave unticked** (22 Nov) | Needs the coordinator's email set (Settings) **and** email on the server, but email is deliberately **off** (`RESEND_API_KEY` not set, runbook "Data stays in Kenya": Resend is in the US) |
| IDSR Weekly | Weekly Submission: **leave unticked** (22 Nov) | Same reason: the Monday MOH 505 email cannot send while email is off |

### Section 6: Interoperability

| Field | Answer |
|---|---|
| LOINC | **Yes** once lab tests have LOINC codes in Settings (vital signs are LOINC-coded already) |
| Other terminology | Also add: "WHO ICD-11 MMS 2025-01; SNOMED CT categories for service orders" (only if you also tick SNOMED: leave SNOMED unticked) |
| Level 4, Able to connect to Kenya HIE | **After** the first successful test with DHA's credentials |

---

## Check before paying (22 Nov 2026)

Checked against the code and the live site acisi.co.ke on 22 Nov 2026:
- Sections 1-6 claims match the code (bcrypt, 5 PINs/5 min lock, 15-min
  logoff, AES-256-GCM fields and files, append-only hash-chained audit log,
  sharing consent off by default, under-18 refusal, 5 roles, ICD-11 1-5 codes,
  FHIR doctors only, TLS 1.2/1.3 + HSTS live).
- The 20-21 Nov release **is installed** on acisi.co.ke (its screens are in
  the live console; no patient residence fields).
- Two ticks removed above: CDS "Uses Problem List", ePrescribing "Includes
  Problem List".
- Only the owner can confirm: MFA switched on (`STAFF_MFA_ENABLED=true`),
  restore-test date (H2), LOINC codes entered on lab tests.
- Real-Time Reporting / Weekly Submission: leave unticked. Email is off on
  the server (runbook "Data stays in Kenya"), so the SCDSC emails cannot send.
