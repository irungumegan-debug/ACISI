# ACISI manual test checklist before the DHA submission

Covers everything built up to 14 November 2026 (pull requests up to #64).
Sections A–O are tests. The last section lists things to **confirm** or decide.

Use **test patients and test staff only**, never real patient data. Work on the
live site (acisi.co.ke) after the latest update is installed (section 0). Tick
each box when the result matches "Expect". If something doesn't match, write
down the item number and what you saw, and send it to Claude (no patient
details, no screenshots with real names).

**You need, at one clinic:** a **clinic admin**, a **front-desk** login, a
**doctor** login, a **lab technician** login (sign one up with the clinic's
invite code), and **two or three test patients**, at least one with a portal
account and a phone you can check. Give test patients names starting with
"TEST" so they are easy to spot later.

**SMS:** until the TextSMS sender ID is connected, SMS run on the Africa's
Talking **sandbox**: nothing reaches a real phone. Items marked *(simulator)*
are checked in the Africa's Talking simulator instead, or left until real SMS
works (see T8).

**Suggested order:** 0, then O (one full visit, about 30 minutes), then A–N
for the details.

---

## 0. Before you start: the latest update is installed

- [ ] **0.1 Update.** On the server: back up, update, restart (runbook "Updating the app"). *Expect:* `curl -s https://acisi.co.ke/healthz` prints `{"status":"ok"}`.
- [ ] **0.2 Bundled files.** `sudo ls /opt/acisi/app/dist/assets/icd11/ /opt/acisi/app/dist/assets/dha/` *Expect:* `icd11-mms-2025-01.json` and `erx-terminology-0.1.0.json`.
- [ ] **0.3 Menus.** Log in as each role. *Expect:*
  - **Admin:** Queue, Patients, Appointments, Daily summary, Routine reports, Disease surveillance, Settings.
  - **Doctor:** My queue, Appointments, Disease surveillance, Routine reports.
  - **Front desk:** Queue, Patients, Appointments, checkout. No Disease surveillance or Routine reports.
  - **Lab technician:** Lab queue only.

## O. One full visit, start to finish (do this first)

One test patient goes through every step. Each line names the section with
the detailed tests.

- [ ] **O1. Check in** a TEST patient as a walk-in at the front desk. *Expect:* they appear under Waiting. (A)
- [ ] **O2. Queue number.** The patient logs in to the portal. *Expect:* "My visit today … You're number N". (M)
- [ ] **O3. Doctor opens** the patient. *Expect:* portal card says "With the doctor". (M)
- [ ] **O4. Allergy.** Record "Penicillin, severe, rash". *Expect:* red Allergies banner. (I)
- [ ] **O5. Lab request.** Request a Malaria RDT, with PIN. *Expect:* patient leaves the doctor's queue; front desk shows "At the lab"; portal says "At the lab". (B, M)
- [ ] **O6. Lab results.** Lab technician enters "Positive", flag Abnormal, attaches a photo, signs. *Expect:* patient back in the doctor's queue as "Back from lab". (B)
- [ ] **O7. Diagnosis.** Doctor picks ICD-11 **1F40.Z** (malaria). (J)
- [ ] **O8. Prescription.** Add Amoxicillin. *Expect:* allergy warning; remove it and add an antimalarial and paracetamol instead; no warning. (L)
- [ ] **O9. Sign.** *Expect:* "counted in the weekly report" (malaria is weekly). (K)
- [ ] **O10. Checkout.** Front desk. *Expect:* the bill already lists the consultation and the Malaria RDT; record cash; visit Done; the "My visit today" card disappears from the portal. (A, B)
- [ ] **O11. Patient's record.** Portal → My records. *Expect:* diagnosis with its ICD-11 code, prescription one line per medicine, lab result, allergy. Download the PDF. (I, J, L, B)
- [ ] **O12. Reports.** Admin → Disease surveillance → this week. *Expect:* Suspected Malaria row counts 1. Routine reports → this month. *Expect:* the visit, the diagnosis in Top diagnoses, "Malaria" in the IDSR monthly table, the lab request, the medicines. (K, N)
- [ ] **O13. FHIR.** As the doctor, open the patient's `$everything` link (G2). *Expect:* the visit, Condition with the ICD-11 code, AllergyIntolerance, MedicationRequests with DHA codes, lab Observations. (G)

## A. Check-in and checkout

- [ ] **A1. Walk-in, new patient.** Front desk → Check in walk-in patient → a new TEST patient. *Expect:* appears in Today's queue under Waiting, no error.
- [ ] **A2. Walk-in, existing patient.** Same, with a patient already registered. *Expect:* checked in, no error.
- [ ] **A3. Remote check-in.** Patient portal → Check in. *Expect:* check-in created (M-Pesa prompt in sandbox), no "something went wrong".
- [ ] **A4. Checkout.** After the doctor signs → front desk checkout → record a cash payment. *Expect:* bill paid, visit Done.
- [ ] **A5. Under-18 at the desk.** Walk-in check-in of a child (parent's phone). *Expect:* allowed at the front desk (the under-18 block is only for online self-signup, E3).

## B. Lab orders

- [ ] **B1. Test list.** Admin → Settings → Lab tests → add "Malaria RDT", KES 300, and one more. Edit a price. Stop offering one. *Expect:* list updates; a duplicate name is refused.
- [ ] **B2. Lab technician signup.** Website → Sign up → Lab technician, with the invite code. *Expect:* account created; after login, only "Lab queue" in the menu.
- [ ] **B3. Doctor requests tests.** Doctor opens a waiting patient → Request lab tests → tick tests → PIN. *Expect:* wrong PIN refused; with the right PIN the patient leaves the doctor's queue; front desk sees them under **At the lab**.
- [ ] **B4. Lab queue.** Lab technician. *Expect:* the request shows name, ACISI ID, age, sex, tests; **no** phone number, diagnosis, allergies or prescriptions.
- [ ] **B5. Enter results.** Open the request → result/unit/flag per test → Save for later → come back. *Expect:* saved values are still there. "Results ready" is disabled until every test has a result or flag.
- [ ] **B6. Attach printout.** Attach a PDF or photo. *Expect:* it appears as "Printout 1"; a non-PDF/non-image is refused.
- [ ] **B7. Sign results.** Results ready → PIN. *Expect:* "Results sent to the doctor"; lab queue empty.
- [ ] **B8. Back to the doctor.** Doctor's queue. *Expect:* patient shows **Back from lab**; opening them shows the results and the printout.
- [ ] **B9. "Results ready" SMS** *(simulator)*. *Expect:* "Your lab results at … are ready. Please go back to the doctor." with **no** test names or results.
- [ ] **B10. Billing.** Front desk checkout. *Expect:* bill already lists each lab test with its price.
- [ ] **B11. Printed record.** Front desk → patient → Print visit record. *Expect:* PDF includes a Lab results section.
- [ ] **B12. Patient portal.** After checkout, patient → My records. *Expect:* lab results shown; downloaded PDF includes them.

## C. Who can see what (role safety)

Type the addresses straight into the browser too: a hidden menu item is not
enough.

- [ ] **C1. Lab technician** can't open Queue, Patients, Appointments, Checkout, Settings, Disease surveillance or Routine reports. *Expect:* an error or nothing.
- [ ] **C2. Doctor** can't check a patient out (front desk only).
- [ ] **C3. Front desk** never sees a diagnosis, allergy notes, prescription lines or lab result on screen (only on a printed record the patient asks for). `/console/surveillance` and `/console/reports/routine` show an error.
- [ ] **C4. Doctor** sees only patients in their own queue.
- [ ] **C5. Clinic admin** sees weekly counts, events and routine reports, but **not** the notifiable case list (which names patients).
- [ ] **C6. Reports have no names.** Weekly CSV and routine report CSV. *Expect:* numbers only, no patient names or phone numbers.

## D. Patient files

- [ ] **D1. Upload.** Front desk → patient page → Upload a file (PDF/JPG), with category and date. *Expect:* listed; opens in the browser.
- [ ] **D2. Photograph paper file.** On a phone: take 2–3 photos → save. *Expect:* one PDF under Previous records with that many pages.
- [ ] **D3. Wrong file type.** Upload a .docx renamed to .pdf. *Expect:* refused.
- [ ] **D4. Patient upload.** Patient portal → My files → upload. *Expect:* listed as "Uploaded by you".
- [ ] **D5. Another clinic.** (If you have two clinics) the other clinic can't see the file unless the patient allows sharing.
- [ ] **D6. Owner storage.** Owner site → Overview. *Expect:* "Uploaded files" tile with disk use.

## E. Security (DHA)

- [ ] **E1. Inactivity logoff.** Leave a console tab untouched for 15+ minutes. *Expect:* logged out; login page says "logged out after 15 minutes without activity". Same in the patient portal.
- [ ] **E2. Activity keeps you in.** Keep clicking every few minutes for 20 minutes. *Expect:* still logged in.
- [ ] **E3. Under-18 signup.** Website → patient signup with a date of birth under 18. *Expect:* refused with the parent/guardian message.
- [ ] **E4. Date of birth required** at patient signup. *Expect:* can't continue without it.
- [ ] **E5. Encryption reads normally.** Open, as the right role: an old visit, an allergy with a note, a prescription with an allergy override reason, a public health event description, an ID number. *Expect:* all read normally (no scrambled "enc:v1:" text anywhere).
- [ ] **E6. Audit trail intact.** On the server:
  `sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s verify-audit-log'`
  *Expect:* "Audit log chain intact".
- [ ] **E7. Encryption complete.** On the server, `npm run -s encrypt-existing-data` (preview, same style as E6). *Expect:* 0 everywhere.
- [ ] **E8. Wrong PIN lockout.** Enter a wrong PIN 5 times at the console login. *Expect:* "Too many wrong PINs. Try again in 5 minutes."; the right PIN works after 5 minutes.

## F. Multi-factor login (only after it's switched on, once real SMS works)

- [ ] **F1.** Doctor logs in → asked for a 6-digit SMS code → enters it → in.
- [ ] **F2.** Wrong code 5 times → must start again.
- [ ] **F3.** "Remember this device" ticked → next login on that browser needs no code.
- [ ] **F4.** Front desk login → no code asked.
- [ ] **F5.** Reset a doctor's PIN → their remembered device asks for a code again.

## G. FHIR interface

- [ ] **G1.** Open https://acisi.co.ke/fhir/r4/metadata in a browser. *Expect:* text starting `{"resourceType":"CapabilityStatement"`.
- [ ] **G2.** Logged in as a doctor with a patient in their queue, open `https://acisi.co.ke/fhir/r4/Patient/<patient id>/$everything`. *Expect:* a Bundle with Patient, Encounter, Condition (diagnosis), AllergyIntolerance, MedicationRequest (prescription) and Observation (lab results).
- [ ] **G3.** Same address logged in as front desk. *Expect:* refused (OperationOutcome "Only doctors…").
- [ ] **G4.** Not logged in. *Expect:* refused.

## H. Server and backups

- [ ] **H1. Backup.** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager` *Expect:* "Backup written", no "Failed".
- [ ] **H2. Restore test.** `sudo acisi-restore-test` (needs your backup private key). *Expect:* row counts match. **Write down the date** for the DHA form.
- [ ] **H3. Redis memory.** `redis-cli info memory | grep used_memory_human` *Expect:* a few MB, well under 64 MB; check again a week later, should stay small.
- [ ] **H4. Disk.** `df -h /` *Expect:* under 50% used; check weekly.
- [ ] **H5. Log size.** `sudo ls -lh /var/log/syslog*` *Expect:* no file over a few hundred MB.
- [ ] **H6. Background jobs.** `sudo journalctl -u acisi -n 50 --no-pager | grep -ci error` *Expect:* 0 or close to it (send Claude the count, not the lines).

## I. Allergies

- [ ] **I1.** Doctor → patient → Record an allergy (Penicillin, severe, reaction "rash"). *Expect:* red Allergies banner at the top.
- [ ] **I2.** Remove it with a reason. *Expect:* gone from the banner, listed under History with who/when/why.
- [ ] **I3.** Patient portal → My records. *Expect:* "My allergies" lists current allergies.
- [ ] **I4.** Front desk can't record allergies.
- [ ] **I5.** FHIR (as G2). *Expect:* an AllergyIntolerance for each current allergy.

## J. ICD-11 diagnoses

- [ ] **J1.** Doctor → waiting patient → Diagnosis (ICD-11) → type "malaria". *Expect:* a list of WHO codes and titles; pick one, it appears as a chip.
- [ ] **J2.** Type a code, e.g. "1A00". *Expect:* Cholera at the top.
- [ ] **J3.** Try "Continue to sign" with no code. *Expect:* "Choose at least one ICD-11 diagnosis".
- [ ] **J4.** Pick two codes, add a note, sign. *Expect:* signed; the sign screen listed both codes.
- [ ] **J5.** Next visit of that patient (doctor view). *Expect:* history shows the codes and "Notes:".
- [ ] **J6.** Front desk → patient page. *Expect:* no codes or notes on screen; the printed visit record shows "ICD-11 …" lines.
- [ ] **J7.** Patient portal → My records (after checkout). *Expect:* diagnosis shown as "Title (ICD-11 code)".
- [ ] **J8.** FHIR (as G2). *Expect:* each Condition has `"system":"http://id.who.int/icd/release/11/mms"` and the code.

## K. Notifiable diseases (cases from diagnoses)

- [ ] **K1. Menu.** Doctor and clinic admin each see **Disease surveillance**. Front desk and lab technician don't.
- [ ] **K2. Immediate alert.** Doctor signs a TEST patient with **1A00 Cholera**. *Expect:* "Signed. Notifiable disease … report within 24 hours" screen.
- [ ] **K3. SMS reminder** *(simulator)*. *Expect:* admins and doctors get "An immediately notifiable disease was diagnosed at … Report within 24h…", with **no** patient name and **no** disease.
- [ ] **K4. Badge.** Doctor's menu shows a red number on Disease surveillance (cases + events). Admin's badge counts events only.
- [ ] **K5. Case list.** Doctor → Disease surveillance. *Expect:* the case with name, ACISI ID, age, sex, disease, code, "Report within 24 hours". Below it, the Public health events card, then the Weekly summary.
- [ ] **K6. Mark reported.** Mark as reported with a note. *Expect:* green "Reported … by …"; the badge goes down.
- [ ] **K7. Weekly-only disease.** Sign a TEST patient with a malaria code (e.g. 1F40.Z). *Expect:* "counted in the weekly report"; no SMS.
- [ ] **K8. Not notifiable.** Sign with BA00 (hypertension). *Expect:* straight back to the queue, no alert.
- [ ] **K9. Weekly summary.** Admin → Disease surveillance → Next to this week. *Expect:* rows in the same order as the MOH 505 form; counts under 5 / 5 and over match your test patients; a Deaths column; AEFI, SARI, maternal/neonatal/malaria deaths and "Others" rows say "from recorded events"; **no** names anywhere.
- [ ] **K10. CSV.** Download the CSV. *Expect:* opens in Excel/Sheets; names the source (IDSR Technical Guidelines, 3rd edition); has Source and Deaths (under 5 / 5 and over) columns.
- [ ] **K11. Front desk** typing `/console/surveillance` sees an error, nothing else.

## L. Prescriptions and allergy warning

- [ ] **L1. Medicine search.** Doctor → waiting TEST patient → Prescription → type "paracetamol 500". *Expect:* DHA medicines with codes (e.g. GE10177 Paracetamol 500 mg Oral Tablet); picking one fills Unit (tablets) and Route (Oral).
- [ ] **L2. Quantity.** Dose 2, 3 times a day, 3 days. *Expect:* Quantity to give fills in 18 by itself; you can change it.
- [ ] **L3. Not on the list.** Type a made-up medicine → "Use … (not on DHA's list)". *Expect:* accepted, marked "not on DHA's list".
- [ ] **L4. Allergy warning.** Record a Penicillin allergy, then add "Amoxicillin 500 mg Oral Capsule". *Expect:* red "Allergy warning … same group (penicillins)" on that card.
- [ ] **L5. Blocked without a reason.** Continue to sign. *Expect:* "Medicine 1 clashes with a recorded allergy…". Give a reason → signing works; the sign screen shows the override in red.
- [ ] **L6. No false alarm.** Paracetamol with the same patient. *Expect:* no warning.
- [ ] **L7. Current medicines.** Next visit of that patient. *Expect:* "Current medicines" lists them, with the override reason; finished courses under "Medication history".
- [ ] **L8. SMS and record.** Checkout. *Expect:* the SMS *(simulator)* and the printed record show one line per medicine (a long prescription in the SMS says "see your ACISI profile").
- [ ] **L9. FHIR.** As G2. *Expect:* MedicationRequests with `"code":"GE…"` and the DHA route and unit codes.

## M. Live queue position

- [ ] **M1. Walk-in sees their number.** Front desk checks in 3 TEST patients (A, B, C); C has a portal account. C logs in. *Expect:* "My visit today … You're number 3".
- [ ] **M2. It moves by itself.** Doctor opens patient A. Wait up to 20 seconds without touching C's phone. *Expect:* C's card changes to "You're number 2".
- [ ] **M3. Stages.** Doctor opens C. *Expect:* "With the doctor"; after a lab request "At the lab"; when results are signed "Back from the lab"; after signing "Ready to pay".
- [ ] **M4. Remote check-in SMS** *(simulator)*. Check in from the portal with others waiting. *Expect:* "…Payment confirmed: KES … You are number N in the queue."
- [ ] **M5. Nearly-next SMS** *(simulator)*. A patient waiting 10+ minutes with 2 or fewer ahead. *Expect:* one SMS "ACISI: 2 people are ahead of you at …" (or "You are next at …"); never a second one for the same visit.
- [ ] **M6. Opted out.** A patient marked "does not want SMS". *Expect:* no nearly-next SMS; the portal card still works.

## N. Public health events and routine reports

- [ ] **N1. Menu.** Doctor and clinic admin see **Routine reports**; front desk and lab technician don't (typing `/console/reports/routine` shows an error).
- [ ] **N2. Record an immediate event.** Admin → Disease surveillance → Record an event → "Cluster of unwell people…", today, 5 affected (1 under 5), a TEST description. *Expect:* "Event recorded. Report it … within 24 hours"; red "Report within 24 hours"; the menu badge goes up.
- [ ] **N3. SMS** *(simulator)*. *Expect:* admins and doctors get "ACISI: A public health event was recorded at … Report within 24h…", with no details.
- [ ] **N4. Checks.** Try a future date, or "Maternal death" with 0 deaths. *Expect:* refused with a clear message.
- [ ] **N5. Mark reported.** *Expect:* green "Reported … by …"; the badge goes down.
- [ ] **N6. Weekly event.** Record a neonatal death (1, under 5). *Expect:* "Weekly report", no SMS.
- [ ] **N7. Weekly summary.** Go to this week. *Expect:* the "Others (specify) … public health event" row shows 5 cases; "Neonatal deaths" shows 1 under Deaths.
- [ ] **N8. Monthly report.** Routine reports → Monthly → this month. *Expect:* visits and patients match your test visits; your test diagnoses in Top diagnoses; a TEST patient signed with BA00 counts once under "Hypertension (New cases)", and not again on a second visit.
- [ ] **N9. Quarterly / annual.** Switch to Quarterly and Annual. *Expect:* totals equal or larger than the month's.
- [ ] **N10. CSV.** Download. *Expect:* opens in Excel/Sheets; no patient names anywhere.

## To confirm (not tests: things only you can check or decide)

**20 Nov 2026:** DHA did not reply, so T5, T11, T12 and T13 are submitted as
known gaps (G2–G4 in `docs/compliance/DHA-self-attestation-answers-2026-11-20.md`)
and no longer block the submission.

Bring these to the DHA/MOH call or check them yourself; tell Claude the
answers and the code will be updated.

- [x] **T1. Disease list.** Done 14 Nov: built from the IDSR Technical Guidelines, 3rd edition (Table 5 and the MOH 505 form) you downloaded.
- [x] **T2. Week.** Done: Monday to Sunday (guidelines).
- [x] **T3. Age groups.** Done: under 5 / 5 and over (MOH 505 form).
- [ ] **T4. Deaths.** Deaths recorded as public health events are counted (maternal, neonatal, malaria deaths, clusters); deaths from other diseases (e.g. a cholera death) are still filled in by hand. Decide: should ACISI also record deaths on a visit?
- [ ] **T5. Sending weekly and immediate reports.** Immediate cases go to the SCDSC (form MOH 502), weekly MOH 505 to the SCDSC by Monday. Ask DHA/MOH: should ACISI send these automatically (KHIS/eIDSR or the HIE)?
- [ ] **T6. Privacy Notice.** Approve adding a sentence such as: *"Your clinic must report some infectious diseases (for example cholera or measles) to the Ministry of Health's public health officers, as the law requires."* (Then the ODPC record may need the same update.)
- [ ] **T7. DPIA v1.3.** Read and sign: notifiable disease reporting (v1.2) and public health events (v1.3) were added (sections 2.4, 2.5, 2.6, 4.2, action A9).
- [ ] **T8. Real SMS.** When TextSMS is connected, re-run every *(simulator)* item (B9, K3, L8, M4, M5, N3) with real phones, then section F.
- [ ] **T9. Restore test date** (H2) for the DHA form.
- [ ] **T10. 2012 vs 2022 lists.** The older chart you sent (2012) differs from the 3rd edition (e.g. rabies, typhoid and dysentery are now immediate; COVID-19, chikungunya, Zika and smallpox were added). ACISI follows the 3rd edition. If your Sub-County still uses the older chart, tell Claude.
- [ ] **T11. Medicines list terms.** DHA's ePrescription guide is CC-BY 4.0, but says the medicine list (from the Pharmacy and Poisons Board) is "subject to separate terms". Ask DHA whether ACISI may use and keep a copy of the list.
- [ ] **T12. Monthly report to MOH.** The guidelines' monthly table goes to the Sub-County. Ask DHA/MOH: which form (MOH 705A/B in KHIS?) and should ACISI send it automatically?
- [ ] **T13. HIE test access.** Email interoperability@dha.go.ke for the HIE test credentials and spec; ACISI's FHIR connection to DHA is built after that.

---

**When everything is ticked:** write the date here: ______________

Anything that failed: send Claude the item number and what you saw.
