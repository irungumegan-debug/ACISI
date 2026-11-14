# ACISI manual test checklist (features built 13–14 November 2026)

Sections A–K are tests; the last section lists things to **confirm**.

Use **test patients and test staff only**, never real patient data. Work on the
live site (acisi.co.ke) after each update is installed. Tick each box when the
result matches "Expect". If something doesn't match, note what you saw and
send it to Claude.

You need, at one clinic: a **clinic admin**, a **front-desk** login, a
**doctor** login, a **lab technician** login (sign one up with the invite
code), and a **test patient** with a phone you can check.

---

## A. Check-in (fixed 14 Nov, PR #59: test this first)

- [ ] **A1. Walk-in check-in.** Front desk → Check in walk-in patient → a new test patient. *Expect:* patient appears in Today's queue under Waiting, no error.
- [ ] **A2. Walk-in for an existing patient.** Same, with a patient already registered. *Expect:* checked in, no error.
- [ ] **A3. Remote check-in.** Patient portal → Check in. *Expect:* check-in created (M-Pesa prompt in sandbox), no "something went wrong".
- [ ] **A4. Checkout payment.** Doctor finishes a consultation → front desk checkout → record a cash payment. *Expect:* bill paid, visit Done.

## B. Lab orders

- [ ] **B1. Test list.** Admin → Settings → Lab tests → add "Malaria RDT", KES 300, and one more. Edit a price. Stop offering one. *Expect:* list updates; a duplicate name is refused.
- [ ] **B2. Lab technician signup.** Website → Sign up → Lab technician, with the invite code. *Expect:* account created; after login, only "Lab queue" in the menu.
- [ ] **B3. Doctor requests tests.** Doctor opens a waiting patient → Request lab tests → tick tests → PIN. *Expect:* wrong PIN refused; with the right PIN the patient leaves the doctor's queue; front desk sees them under **At the lab**.
- [ ] **B4. Lab queue.** Lab technician. *Expect:* the request shows name, ACISI ID, age, sex, tests; **no** phone number or diagnosis.
- [ ] **B5. Enter results.** Open the request → result/unit/flag per test → Save for later → come back. *Expect:* saved values are still there. "Results ready" is disabled until every test has a result or flag.
- [ ] **B6. Attach printout.** Attach a PDF or photo. *Expect:* it appears as "Printout 1"; a non-PDF/non-image is refused.
- [ ] **B7. Sign results.** Results ready → PIN. *Expect:* "Results sent to the doctor"; lab queue empty.
- [ ] **B8. Back to the doctor.** Doctor's queue. *Expect:* patient shows **Back from lab**; opening them shows the results and the printout.
- [ ] **B9. "Results ready" SMS.** *Expect (only once real SMS is live):* patient gets "Your lab results at … are ready. Please go back to the doctor." with **no** test names or results. In sandbox, check the Africa's Talking simulator instead.
- [ ] **B10. Billing.** Front desk checkout. *Expect:* bill already lists each lab test with its price.
- [ ] **B11. Printed record.** Front desk → patient → Print visit record. *Expect:* PDF includes a Lab results section.
- [ ] **B12. Patient portal.** After checkout, patient → My records. *Expect:* lab results shown; downloaded PDF includes them.

## C. Who can see what (role safety)

- [ ] **C1. Lab technician** can't open Queue, Patients, Appointments, Checkout or Settings (typing the address directly shows an error or nothing).
- [ ] **C2. Doctor** can't check a patient out (no checkout option; front desk only).
- [ ] **C3. Front desk** never sees a diagnosis or lab result on screen (only on a printed record).
- [ ] **C4. Doctor** sees only patients in their own queue.

## D. Patient files

- [ ] **D1. Upload.** Front desk → patient page → Upload a file (PDF/JPG), with category and date. *Expect:* listed; opens in the browser.
- [ ] **D2. Photograph paper file.** On a phone: take 2–3 photos → save. *Expect:* one PDF under Previous records with that many pages.
- [ ] **D3. Wrong file type.** Upload a .docx renamed to .pdf. *Expect:* refused.
- [ ] **D4. Patient upload.** Patient portal → My files → upload. *Expect:* listed as "Uploaded by you".
- [ ] **D5. Another clinic.** (If you have two clinics) the other clinic can't see the file unless the patient allows sharing.
- [ ] **D6. Owner storage.** Owner site → Overview. *Expect:* "Uploaded files" tile with disk use.

## E. Security fixes (DHA)

- [ ] **E1. Inactivity logoff.** Leave a console tab untouched for 15+ minutes. *Expect:* logged out, login page says "logged out after 15 minutes without activity". Same in the patient portal.
- [ ] **E2. Activity keeps you in.** Keep clicking every few minutes for 20 minutes. *Expect:* still logged in.
- [ ] **E3. Under-18 signup.** Website → patient signup with a date of birth under 18. *Expect:* refused with the parent/guardian message.
- [ ] **E4. Date of birth required** at patient signup. *Expect:* can't continue without it.
- [ ] **E5. Encryption works normally.** Open an old visit as a doctor and a patient record in the portal. *Expect:* diagnoses, prescriptions and ID numbers read normally (no scrambled "enc:v1:" text anywhere).
- [ ] **E6. Audit trail intact.** On the server:
  `sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s verify-audit-log'`
  *Expect:* "Audit log chain intact".
- [ ] **E7. Encryption complete.** On the server, `npm run -s encrypt-existing-data` (preview, same style as E6). *Expect:* 0 everywhere.

## F. Multi-factor login (only after it's switched on, once real SMS works)

- [ ] **F1.** Doctor logs in → asked for a 6-digit SMS code → enters it → in.
- [ ] **F2.** Wrong code 5 times → must start again.
- [ ] **F3.** "Remember this device" ticked → next login on that browser needs no code.
- [ ] **F4.** Front desk login → no code asked.
- [ ] **F5.** Reset a doctor's PIN → their remembered device asks for a code again.

## G. FHIR interface

- [ ] **G1.** Open https://acisi.co.ke/fhir/r4/metadata in a browser. *Expect:* text starting `{"resourceType":"CapabilityStatement"`.
- [ ] **G2.** Logged in as a doctor with a patient in their queue, open `https://acisi.co.ke/fhir/r4/Patient/<patient id>/$everything`. *Expect:* a Bundle with the visit, diagnosis, prescription and lab results.
- [ ] **G3.** Same address logged in as front desk. *Expect:* refused (OperationOutcome "Only doctors…").

## H. Server and backups

- [ ] **H1. Backup.** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager` *Expect:* "Backup written", no "Failed".
- [ ] **H2. Restore test.** `sudo acisi-restore-test` (needs your backup private key). *Expect:* row counts match. **Write down the date** for the DHA form.
- [ ] **H3. Redis memory.** `redis-cli info memory | grep used_memory_human` *Expect:* a few MB, well under 64 MB; check again a week later, should stay small.
- [ ] **H4. Disk.** `df -h /` *Expect:* under 50% used; check weekly.
- [ ] **H5. Log size.** `sudo ls -lh /var/log/syslog*` *Expect:* no file over a few hundred MB.

## I. Allergies (after the allergy update is installed)

- [ ] **I1.** Doctor → patient → Record an allergy (Penicillin, severe, reaction "rash"). *Expect:* red Allergies banner at the top.
- [ ] **I2.** Remove it with a reason. *Expect:* gone from the banner, listed under History with who/when/why.
- [ ] **I3.** Patient portal → My records. *Expect:* "My allergies" lists current allergies.
- [ ] **I4.** Front desk can't record allergies.

## J. ICD-11 diagnoses (after the ICD-11 update is installed)

- [ ] **J1.** Doctor → waiting patient → Diagnosis (ICD-11) → type "malaria". *Expect:* a list of WHO codes and titles; pick one, it appears as a chip.
- [ ] **J2.** Type a code, e.g. "1A00". *Expect:* Cholera at the top.
- [ ] **J3.** Try "Continue to sign" with no code. *Expect:* "Choose at least one ICD-11 diagnosis".
- [ ] **J4.** Pick two codes, add a note, sign. *Expect:* signed; the sign screen listed both codes.
- [ ] **J5.** Next visit of that patient (doctor view). *Expect:* history shows the codes and "Notes:".
- [ ] **J6.** Front desk → patient page. *Expect:* no codes or notes on screen; the printed visit record shows "ICD-11 …" lines.
- [ ] **J7.** Patient portal → My records (after checkout). *Expect:* diagnosis shown as "Title (ICD-11 code)".
- [ ] **J8.** FHIR (as G2). *Expect:* each Condition has `"system":"http://id.who.int/icd/release/11/mms"` and the code.

## K. Notifiable diseases (after the disease-surveillance update is installed)

- [ ] **K1. Menu.** Doctor and clinic admin each see **Disease surveillance**. Front desk and lab technician don't.
- [ ] **K2. Immediate alert.** Doctor signs a test patient with **1A00 Cholera**. *Expect:* "Signed. Notifiable disease … report within 24 hours" screen.
- [ ] **K3. SMS reminder** *(once real SMS is live; in sandbox, check the Africa's Talking simulator)*. *Expect:* admins and doctors get "An immediately notifiable disease was diagnosed at … Report within 24h…", with **no** patient name and **no** disease.
- [ ] **K4. Badge.** Doctor's menu shows a red number on Disease surveillance.
- [ ] **K5. Case list.** Doctor → Disease surveillance. *Expect:* the case with name, ACISI ID, age, sex, disease, code, "Report within 24 hours".
- [ ] **K6. Mark reported.** Mark as reported with a note. *Expect:* green "Reported … by …"; the badge goes down.
- [ ] **K7. Weekly-only disease.** Sign a test patient with a malaria code (e.g. 1F40.Z). *Expect:* "counted in the weekly report"; no SMS.
- [ ] **K8. Not notifiable.** Sign with BA00 (hypertension). *Expect:* straight back to the queue, no alert.
- [ ] **K9. Weekly summary.** Admin → Disease surveillance → Next to this week. *Expect:* rows in the same order as the MOH 505 form; counts under 5 / 5 and over match your test patients; deaths and events say "count by hand"; **no** names anywhere; the cases list is not shown to admins.
- [ ] **K10. CSV.** Download the CSV. *Expect:* opens in Excel/Sheets; names the source (IDSR Technical Guidelines, 3rd edition) and says deaths are filled by hand.
- [ ] **K11. Front desk** typing `/console/surveillance` sees an error, nothing else.

## L. Prescriptions and allergy warning (after the prescriptions update is installed)

- [ ] **L1. Medicine search.** Doctor → waiting test patient → Prescription → type "paracetamol 500". *Expect:* DHA medicines with codes (e.g. GE10177 Paracetamol 500 mg Oral Tablet); picking one fills Unit (tablets) and Route (Oral).
- [ ] **L2. Quantity.** Dose 2, 3 times a day, 3 days. *Expect:* Quantity to give fills in 18 by itself; you can change it.
- [ ] **L3. Not on the list.** Type a made-up medicine → "Use … (not on DHA's list)". *Expect:* accepted, marked "not on DHA's list".
- [ ] **L4. Allergy warning.** Record a Penicillin allergy, then add "Amoxicillin 500 mg Oral Capsule". *Expect:* red "Allergy warning … same group (penicillins)" on that card.
- [ ] **L5. Blocked without a reason.** Continue to sign. *Expect:* "Medicine 1 clashes with a recorded allergy…". Give a reason → signing works; the sign screen shows the override in red.
- [ ] **L6. No false alarm.** Paracetamol with the same patient. *Expect:* no warning.
- [ ] **L7. Current medicines.** Next visit of that patient. *Expect:* "Current medicines" lists them, with the override reason; finished courses under "Medication history".
- [ ] **L8. SMS and record.** Checkout. *Expect:* the SMS (simulator) and the printed record show one line per medicine (a long prescription in the SMS says "see your ACISI profile").
- [ ] **L9. FHIR.** As G2. *Expect:* MedicationRequests with `"code":"GE…"` and the DHA route and unit codes.

## To confirm (not tests: things only you can check or decide)

Bring these to the DHA/MOH call or check them yourself; tell Claude the answers and the code will be updated.

- [x] **T1. Disease list.** Done 14 Nov: built from the IDSR Technical Guidelines, 3rd edition (Table 5 and the MOH 505 form) you downloaded.
- [x] **T2. Week.** Done: Monday to Sunday (guidelines).
- [x] **T3. Age groups.** Done: under 5 / 5 and over (MOH 505 form).
- [ ] **T4. Deaths.** The MOH 505 form asks for deaths under 5 and 5 and over for each disease. ACISI doesn't record deaths, so clinics fill those columns by hand. Decide: should ACISI record deaths (e.g. a "patient died" outcome on a visit)?
- [ ] **T5. Sending.** Immediate cases go to the SCDSC (form MOH 502), weekly MOH 505 to the SCDSC by Monday (guidelines). Ask DHA/MOH: should ACISI send these automatically (KHIS/eIDSR or the HIE)?
- [ ] **T6. Privacy Notice.** Approve adding a sentence such as: *"Your clinic must report some infectious diseases (for example cholera or measles) to the Ministry of Health's public health officers, as the law requires."* (Then the ODPC record may need the same update.)
- [ ] **T7. DPIA v1.2.** Read and sign: notifiable disease reporting was added (sections 2.5, 2.6, 4.2, action A9).
- [ ] **T11. Medicines list terms.** DHA's ePrescription guide is CC-BY 4.0, but says the medicine list (from the Pharmacy and Poisons Board) is "subject to separate terms". Ask DHA whether ACISI may use and keep a copy of the list (it's what DHA requires for ePrescribing).
- [ ] **T10. 2012 vs 2022 lists.** The older chart you sent (2012) differs from the 3rd edition (e.g. rabies, typhoid and dysentery are now immediate; COVID-19, chikungunya, Zika and smallpox were added). ACISI follows the 3rd edition. If your Sub-County still uses the older chart, tell Claude.
- [ ] **T8. SMS sender.** When TextSMS is connected, the alert SMS (K3) and MFA (section F) both need a real-delivery test.
- [ ] **T9. Restore test date** (H2) for the DHA form.

---

When everything is ticked, note the date. Anything that failed: send the
item number and what you saw.
