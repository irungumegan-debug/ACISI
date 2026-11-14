# ACISI manual test checklist (features built 13–14 November 2026)

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

---

When everything is ticked, note the date. Anything that failed: send the
item number and what you saw.
