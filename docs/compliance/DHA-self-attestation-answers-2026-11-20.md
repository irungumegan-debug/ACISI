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
| Billing / payments | Cash and M-Pesa recorded; M-Pesa STK push in **sandbox only** (going live next) | `src/mpesa/clinicStk.ts` |

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
| **Multi-Factor Authentication** | ❌ **leave unticked** | Built for admins and doctors (SMS code) but OFF (`STAFF_MFA_ENABLED`) until real SMS delivery works; gap G1 |
| Encryption in transit | ✅ | HTTPS only, TLS 1.2/1.3, HSTS |
| Encryption at rest | ✅ | AES-256-GCM for health fields, ID numbers, next of kin (`src/utils/fieldCrypto.ts`) and uploaded files; key offline |
| Audit trail | ✅ | Every view/change of clinical records logged; append-only (database refuses update/delete) and hash-chained; `npm run verify-audit-log` |
| Consent for sharing between clinics | ✅ | Off by default; patient consent or same-day code; logged |
| Minors | ✅ | Portal signup refuses under-18s; children registered at the clinic with a guardian |
| Backups and restore test | ✅ | Nightly encrypted backups (age), 14 days; restore test **date: fill in from checklist H2** |
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
| G1 | MFA built but off | Switch on when the Kenyan SMS sender ID is live (TextSMS) | Dec 2026 |
| G2 | Not yet connected to the HIE (national identifiers, profiles, system auth) | FHIR R4 interface is built; adapt and connect once DHA issues HIE sandbox credentials and spec (requested 16 Nov 2026) | Within 3 months of DHA providing the spec |
| G3 | Reports not sent automatically to KHIS/eIDSR | Clinics submit the generated MOH 505 / monthly report; automate once DHA/MOH name the route | With G2 |
| G4 | Use of the Pharmacy and Poisons Board medicine list (DHA ePrescription IG) "subject to separate terms" | Asked DHA 16 Nov 2026; will follow DHA's terms or remove the copy | On DHA's answer |
| G5 | Backup copy is on the same server | Off-server copy kept in Kenya | Before onboarding more clinics |
| G6 | No external uptime alert | Add one on `/healthz` | Dec 2026 |
| G7 | Automatic deletion at end of retention | Build | Q2 2027 |
| G8 | Card payments and live M-Pesa | Sandbox only today | Next |
| G9 | Breach procedure does not yet name DHA | Add DHA notification (48 h) to the breach procedure | Dec 2026 |

---

## Before clicking Submit (owner)

1. Run the manual test checklist (`docs/testing/manual-test-checklist.md`),
   at least sections 0, O and E, and H2 for the restore-test date.
2. In the portal, enter the answers above. **Leave the MFA box unticked.**
   Paste section 7 into the gaps / self-assessment field.
3. Documents the regulations ask for with the application (Form HMIS 4):
   system manual, requirements specification, Cyber Security Assessment
   Report, DPIA. Upload what the portal asks for; the DPIA is ready.
4. Pay and submit. Write the submission date and receipt number here:
   ______________
5. Tell Claude, so `CLAUDE.md` and the checklist can be updated.
