# DHA self-attestation: final answers (24 Nov 2026)

Draft reference **DHS-1793019691629-GXVFAJJTJ** (DHA portal, acisihelp@gmail.com).
This replaces the answer sheet of 20 Nov 2026 and its 21 Nov update.

DHA never answered our questions of 16 Nov (interoperability@dha.go.ke
bounces; raymondbett@dha.go.ke did not reply). The open points are declared
as known gaps with a plan (section 7), which is what the self-attestation's
gap section is for.

**How this was checked:** every answer was checked against ACISI's code on
24 Nov 2026 (main branch after PR #72, which is installed on acisi.co.ke).
Rule: **tick only what is live on acisi.co.ke today.** Things that are built
but switched off, or planned, are gaps, never ticks.

---

## 1. Organisation and solution

| Question | Answer |
|---|---|
| Solution name | ACISI |
| Organisation | ACISI Healthcare (business name registration BN-L3SMWLDM), Kenya |
| Type | Clinic management / EMR (outpatient), web console, patient portal; USSD check-in planned (Dec 2026 – early 2027) |
| Users | Small outpatient clinics in Kenya: front desk, clinicians, doctors, lab technicians, clinic admins; patients (portal) |
| Hosting | ACISI's own server at HostAfrica, Nairobi, Kenya; PostgreSQL. Patient records stay in Kenya |
| Data Protection Officer | Megan Irungu (Founder), acisi.help@gmail.com, 0746404155 |
| ODPC registration | Yes. DPIA version 1.5, 24 Nov 2026 (uploaded) |

## 2. Classification

Outpatient EMR / clinic management system handling identifiable health data
(patients, visits, coded diagnoses, prescriptions, lab results, vital signs,
files). Not a medical device. No automated diagnosis: the warnings it shows
(allergy, vital signs, critical lab results, notifiable diseases) support the
clinician, who decides.

## 3. Functionality

### 3.1 What ACISI does (summary)

| Function | Live? | Where in the code |
|---|---|---|
| Patient registration, unique ACISI ID, search; optional national ID / passport / birth certificate | Yes | `src/services/patientService.ts` |
| Check-in and queue (front desk and patient web portal) | Yes. USSD check-in planned | |
| Consultation notes, signed by re-entering the PIN, locked after signing | Yes | |
| Coded diagnoses: WHO ICD-11 MMS 2025-01; the doctor must pick 1–5 codes | Yes | `src/assets/icd11/` |
| Structured ePrescription with DHA ePrescription IG 0.1.0 codes (medicine, route, unit, instructions) | Yes | `src/assets/dha/` |
| Allergy recording; warning when prescribing (override needs a reason, kept encrypted) | Yes | |
| Lab requests and results, signed; LOINC codes for lab tests (set per test in Settings) | Yes | |
| Vital signs with BMI, MUAC and age-adjusted warnings; weight chart | Yes | `src/services/vitalSignsService.ts` |
| Problem list (ICD-11), family history, other orders (radiology, therapy, nutrition, social work, counselling), plan / follow-up, dispensing at checkout | Yes | |
| Patient files (scans, photos of paper records), encrypted on disk | Yes | `src/services/fileStorageService.ts` |
| Payments | Check-in fee: live M-Pesa (STK push, confirmed 20 Nov 2026). Clinic checkout: cash and M-Pesa recorded by staff; checkout STK push and cards not yet live (gap G8) | `src/mpesa/` |

### 3.2 What to tick in the portal, section 3

| Component | Tick | Feature in ACISI |
|---|---|---|
| Demographics | Keep what you ticked; **Residence/Address: leave unticked** | Address is not collected: not in the Privacy Notice, DPIA or ODPC registration (owner, 21 Nov 2026) |
| CPOE | Medications | Structured prescriptions |
| CPOE | Dispensing | Checkout: "Given" (quantity) / "Buying elsewhere" |
| CPOE | Radiology, Physiotherapy, Occupational Therapy, Nutrition/Dietetics, Social Work, Counselling | Consultation: Other orders |
| CPOE | Family History | Consultation: Family history |
| CPOE | Vital Signs, BMI/Growth Charts | Vital signs, BMI, weight-over-time chart, MUAC for children |
| CPOE | MCH Encounter: **leave unticked** | Not built |
| Problem list | Can Update Problems | Resolve, active again, note, entered in error, history |
| Problem list | KNHTS: **leave unticked** | Needs the HIE Terminology Service (DHA credentials) |
| Medication management | Active Medication List, Medication History | Doctor's page |
| Medication management | HPT Registry / HPT Allergy Integration: **leave unticked** | Not integrated |
| Clinical decision support | Switch on; Uses Allergy List, Uses Demographics, Uses Lab Results, Uses Vital Signs. **Uses Problem List: leave unticked** (22 Nov review) | Allergy warning at prescribing; notifiable-disease alert from diagnoses; age-adjusted vital-sign warnings; critical lab result alerts |
| Clinical decision support | Evidence-Based Interventions: **leave unticked** | Warnings use WHO cut-offs (IMCI, MUAC, BMI) but ACISI gives no treatment guidance |
| Clinical decision support | Uses HPT Registry: **leave unticked** | |
| Clinical summary | Includes Biodata, Includes Medications, Includes Care Plan | Visit record: date of birth, sex, ID; current medicines; plan / follow-up |
| Clinical summary | Kenya HIE Exchangeable: **tick** | The visit summary is built as the FHIR Bundle sent to the Shared Health Record (visit, diagnoses, problems, allergies, medicines, lab, vital signs, orders; `src/hie/shrBundle.ts`). Live test with DHA: gap G2 |
| Electronic prescribing | Includes Diagnostic Tests, Includes Medication Lists. **Includes Problem List: leave unticked** (22 Nov review) | The visit record with the prescription carries diagnoses, lab results and current medicines |
| Electronic prescribing | Electronic Transmission: **tick** | Prescriptions (MedicationRequest, DHA codes) and dispensing go in the Bundle sent to the Shared Health Record. Live test with DHA: gap G2 |
| Quality measures | Switch on; Capture, Calculate, Export | Routine reports → Quality measures, CSV |
| Quality measures | Import, Electronic Submission: **leave unticked** | |

## 4. Reporting

| Component | Tick | Feature in ACISI |
|---|---|---|
| Routine Reporting | Switch on; Monthly, Quarterly, Annual | Routine reports (no patient names); IDSR monthly table |
| Public Health Events | Switch on; Event Detection, Alert Mechanism | Event-based surveillance (MOH 505 event and death rows); on-screen banner until reported |
| Events of International Concern | Switch on; IHR Compliant | IHR flag on notifiable diseases |
| Notifiable disease alerts (IDSR Technical Guidelines 3rd ed. 2022, Table 5) | Yes | Immediate-case alert to the clinic's doctors (MOH 502 details) |
| IDSR weekly summary (MOH 505) | Yes | On screen and CSV, Monday–Sunday, under 5 / 5 and over |
| Immediate: Real-Time Reporting; IDSR Weekly: Weekly Submission | **Tick only if** the clinic has saved its Sub-County Disease Surveillance Coordinator's email in Settings **and** the Settings page does **not** say "Email sending isn't set up on the ACISI server yet" | ACISI then emails the immediate notice and the Monday MOH 505 to the coordinator. Otherwise leave unticked: the clinic reports by hand |
| Automatic submission to KHIS / eIDSR / HIE | **No** (gap G3) | The clinic submits the generated reports to the Sub-County |

## 5. Security and privacy

| Control | Tick? | Evidence |
|---|---|---|
| Unique personal login per user, role-based access | ✅ | 5 roles (front desk, clinician, doctor, clinic admin, lab technician). Doctors see only their departments' queue; lab technicians only lab requests; front desk never sees diagnoses or lab results |
| **Multi-Factor Authentication** | ✅ | Live since 24 Nov 2026 for clinic admins and doctors: after the PIN, a 6-digit code from an authenticator app (TOTP; Google or Microsoft Authenticator), no SMS needed. Each person sets it up in Settings → Multi-factor login; until then every page reminds them, and once set up the code is always asked. A device can be remembered for 30 days; a PIN reset forgets it. 5 wrong codes lock the account for 5 minutes. Clinic admins see who has it on (Settings → Staff). `src/services/staffMfaService.ts`, `src/utils/totp.ts` |
| PINs stored hashed | ✅ | bcrypt (`src/services/staffService.ts`) |
| Account lockout | ✅ | 5 wrong PINs → 5-minute lock (`src/services/pinLockout.ts`) |
| PIN reset | ✅ | Staff cannot reset their own PIN; only a clinic admin can (each clinic is asked to keep 2 admins); patients reset theirs with an SMS code |
| Automatic logoff on inactivity | ✅ | 15 minutes; sessions also expire (staff 8 h, clinic admin 6 h, ACISI owner 2 h) |
| Encryption in transit | ✅ | HTTPS only, TLS 1.2/1.3, HSTS |
| Encryption at rest | ✅ | AES-256-GCM for health fields, ID numbers, next of kin, authenticator secrets (`src/utils/fieldCrypto.ts`) and uploaded files; key kept offline as well |
| Audit trail | ✅ | Every view and change of clinical records logged; append-only (the database refuses update and delete) and hash-chained; `npm run verify-audit-log` |
| Consent for sharing between clinics | ✅ | Off by default; patient's standing consent or a same-day code; every view logged |
| Minors | ✅ | Portal signup refuses under-18s; children are registered at the clinic with a parent or guardian |
| Backups and restore test | ✅ | Nightly encrypted backups (age), kept 14 days; practice restore with `acisi-restore-test`. Last restore test: **____________ (fill in from checklist H2)** |
| Off-site backup | ❌ | Gap G5 |
| Breach procedure | ✅ | Clinic told within 48 h, ODPC within 72 h, affected patients when at real risk. DHA not yet named (gap G9) |
| DPIA | ✅ | Version 1.5, 24 Nov 2026 (uploaded) |
| Server hardening | ✅ | SSH key only, no root login, firewall (22/80/443), fail2ban, automatic security updates |

## 6. Interoperability

| Question | Answer |
|---|---|
| Standard | **HL7 FHIR R4** (`/fhir/r4`; CapabilityStatement at `/fhir/r4/metadata`) |
| Resources | Patient, Organization, Practitioner, Encounter, Condition (ICD-11 diagnoses and problem list), AllergyIntolerance, MedicationRequest (DHA codes), MedicationDispense, ServiceRequest (lab and other orders), Observation (lab results, LOINC where coded; vital signs, LOINC), CarePlan; `Patient/$everything` Bundle |
| Guides followed | Kenya Core 1.0.0, Patient Summary 0.1.0, ePrescription 0.1.0. Checked with the official FHIR R4 validator on 20 Nov 2026 with 0 errors for Patient, Organization, Practitioner, Encounter, Condition, AllergyIntolerance, MedicationRequest, ServiceRequest and Observation. CarePlan, MedicationDispense, vital-sign Observations and the problem list were added after that check |
| Terminologies | WHO ICD-11 MMS 2025-01; LOINC (vital signs; lab tests once their codes are set in Settings); DHA ePrescription IG 0.1.0 code lists. SNOMED CT: **leave unticked** |
| LOINC | Tick |
| Access | Logged-in doctors only; front desk and anonymous requests refused |
| Able to connect to the national HIE (Client Registry, Facility Registry, Health Worker Registry, Shared Health Record) | **Yes, built.** Following DHA's published HIE API (hie-docs.dha.go.ke): service-account token (client ID and secret), facility search by name or MFL code, health worker lookup by regulator registration number, client lookup by national ID / passport / birth certificate, Shared Health Record with patient consent per visit (code to the patient's phone), sending the visit record at checkout with retries, reading records from other facilities, closing the visit (`src/hie/`). Switched on with `HIE_ENABLED=true` and DHA's credentials. Not yet tested against DHA's live sandbox: DHA issues the credentials after this attestation is submitted and paid (gap G2) |
| Able to connect to Kenya HIE | **Switch on.** Kenya HIE capabilities: tick Can transmit data to HIE, Can receive data from HIE, FHIR compliant. Data exchange standards: FHIR compliant (not SDMX). FHIR version: R4 (4.0.1). The first live test is declared as gap G2 |
| National identifiers | ACISI's own identifier systems until connected to the Client Registry (G2) |

## 7. Self-assessment: known gaps and plan

Paste this into the gaps / self-assessment field.

| # | Gap | Plan | Target |
|---|---|---|---|
| G1 | ~~Multi-factor login not switched on~~ | **Closed 24 Nov 2026**: authenticator-app login live for clinic admins and doctors | Done |
| G2 | HIE connection built but not yet tested live (Client Registry, Facility Registry, Health Worker Registry, Shared Health Record) | Built from DHA's published HIE API documentation and switched off. Switch on and test as soon as DHA issues the sandbox credentials (after this submission and payment), fix any differences from the documentation, then book UAT with DHA | Within 3 months of receiving credentials |
| G3 | Reports not sent automatically to KHIS / eIDSR | Clinics submit the generated MOH 505 and monthly reports; ACISI emails them to the Sub-County coordinator where set up. Automate once DHA / MOH name the route | With G2 |
| G4 | Pharmacy and Poisons Board medicine list (in DHA's ePrescription IG) is "subject to separate terms" | Asked DHA on 16 Nov 2026; will follow DHA's terms, or remove the copy | On DHA's answer |
| G5 | Backup copy is on the same server | Off-server copy kept in Kenya (prepared, not yet enabled) | Before onboarding more clinics |
| G6 | No external uptime alert | Add one on `/healthz` | Dec 2026 |
| G7 | No automatic deletion at the end of the retention period | Build | Q2 2027 |
| G8 | Card payments and live M-Pesa at clinic checkout | Check-in fee live on M-Pesa since 20 Nov 2026; checkout prompts and cards next | Dec 2026 |
| G9 | Breach procedure does not yet name DHA | Add DHA notification to the breach procedure | Dec 2026 |

---

## 8. Declaration

I confirm that the answers above describe ACISI as it runs on acisi.co.ke on
the date below, and that the gaps in section 7 are all the known gaps.

| | |
|---|---|
| Name | Megan Irungu |
| Position | Founder and Data Protection Officer, ACISI Healthcare |
| Signature | |
| Date | |

---

## Before clicking Submit (owner)

1. **Multi-factor login:** make sure every clinic admin and doctor shows
   "Multi-factor on" in Settings → Staff & doctors.
2. **Restore test:** run `sudo acisi-restore-test` on the server (checklist
   H2) and write the date in section 5.
3. **Email reports (section 4):** decide the two "Tick only if" boxes from
   what the Settings page shows.
4. **Sign** this sheet (section 8) and the DPIA (its section 8).
5. In the portal: enter the ticks above, paste section 7 into the gaps field,
   and upload what the portal asks for. Ready: this sheet and the DPIA. The
   regulations also list a system manual, a requirements specification and a
   Cyber Security Assessment Report (Form HMIS 4): upload them if the portal
   asks.
6. Pay and submit. Write the submission date and receipt number here:
   ______________
7. Tell Claude, so `CLAUDE.md` and the checklist are updated, and to switch on
   the HIE connection once DHA's sandbox credentials appear on the portal.
