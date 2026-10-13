# Pre-launch checklist: patient onboarding release

Run this yourself, end to end, **before any real patient uses these features**.
Everything uses test mode: SMS through the Africa's Talking **sandbox**
(`AT_USERNAME=sandbox`) and M-Pesa through the Daraja **sandbox**
(`MPESA_ENV=sandbox`). Use test phone numbers and made-up patients only.

## 0. Before you start

- [ ] Backup taken: `sudo systemctl start acisi-backup`, then `ls -lh /var/backups/acisi`
- [ ] Deployed with the one-time server steps in `deploy/RUNBOOK.md`
      ("One-time steps for the patient onboarding release"): app service, Nginx, backup job
- [ ] `/etc/acisi/acisi.env` has `AT_USERNAME=sandbox`, `SMS_REPLY_STOP_ENABLED=false`, a `SMS_INBOUND_TOKEN`
- [ ] `curl -s https://acisi.co.ke/healthz` gives `{"status":"ok"}`; `ls -ld /var/lib/acisi` shows `drwx------ acisi acisi`
- [ ] Africa's Talking simulator open (https://simulator.africastalking.com) with two test numbers, A and B.
      Sandbox SMS only show up there.

## 1. Add patient and registration SMS

- [ ] Console → **Patients → Add patient**: a parent on phone A. You see an ACISI ID like `ACS-48217`
- [ ] Phone A gets: *"You're registered with [Clinic] on ACISI. Check in from home next time at acisi.co.ke."*
      (one SMS, no "Reply STOP")
- [ ] Add a child on **the same phone A**: you're shown the parent first and must confirm "new person"
- [ ] Add the parent again: refused as already registered
- [ ] Patients search finds both by phone, name and ACISI ID
- [ ] (Admin) **Import a patient list**: upload a small CSV with one bad row and one repeated row.
      The preview flags them, the import sends **no** SMS, and **Send invitations** sends one SMS per imported patient

## 2. First login: one OTP, then a PIN

- [ ] acisi.co.ke → Log in → Patient → **Get a code by SMS** → phone A
- [ ] Code arrives (6 digits, "expires in 5 minutes"); asked **who you are** (parent / child)
- [ ] Wrong date of birth refused; right one accepted
- [ ] PIN `123456`, `111111` and your date of birth (e.g. `150390`) refused; two different PINs refused
- [ ] Good PIN accepted → **ACISI ID screen** with the warning; can't continue until
      "I have saved my ACISI ID" is ticked → dashboard
- [ ] Log out, log in with **phone + PIN** and with **ACISI ID + PIN**: no SMS is sent
- [ ] The login page shows the hint about logging in with the ACISI ID on a shared phone
- [ ] 5 wrong PINs → locked ~15 minutes, even with the right PIN
- [ ] **Forgot PIN** (code + date of birth + new PIN) unlocks straight away
- [ ] A 4th code within an hour for the same number is refused
- [ ] "Keep me signed in": close and reopen the browser, still logged in

## 3. Remote check-in

- [ ] Portal → **Check in** at the clinic; complete the sandbox M-Pesa prompt (or **Confirm payment**
      on the queue with a test code). The patient appears in the queue

## 4. Walk-in

- [ ] Queue → **Check in walk-in patient** → search by **ACISI ID**, then by **phone A** (both people listed)
- [ ] Can't add to queue until "name and date of birth match" is ticked
- [ ] Search an unknown number → the screen becomes **Add patient**, then continues to the queue
- [ ] No fee charged; the done screen reminds you to tell the patient to check in from home next time
- [ ] SMS: *"You are number N in the queue at [Clinic]…"* (no department name)
- [ ] Doctor opens the patient ahead → the walk-in now first gets *"You're next at [Clinic]…"* (once only)

## 5. Records from other clinics

- [ ] Second test clinic (register one, or use a second seeded clinic with a front-desk login):
      walk the parent in there. Their visit at clinic 1 is **hidden**
- [ ] **Request past records** → phone A gets *"[Clinic] is asking to see your ACISI records from other clinics.
      Your code is ……. Only share it if you agree."*
- [ ] Wrong code refused; right code → clinic 2 now sees clinic 1's visits; the same code can't be used again
- [ ] Portal → Account → **Who can see your records** lists clinic 2 → **Remove access** → clinic 2 can't see them any more
- [ ] Approve again with the **patient's PIN** on the front-desk screen (no SMS sent)
- [ ] A doctor at clinic 2 sees the "hidden" note but no request button

## 6. Files

- [ ] Patient page → **Upload a file**: JPG, PNG and PDF work; a renamed `.txt`/`.html` is refused; a file over 20 MB is refused
- [ ] **Photograph paper file** on a phone/tablet: take 3 photos → one PDF with 3 pages under **Previous records**
- [ ] Portal → My records → **My files** → upload; the clinic sees it labelled **Patient-uploaded**
      (only after the patient has approved that clinic)
- [ ] Clinic 2 (without approval) sees "N more files … hidden" and can't open them; with approval it can
- [ ] On the server: `sudo ls -la /var/lib/acisi/uploads` shows random names, owner `acisi`, no web access
- [ ] Owner site → Overview shows **Uploaded files** and how full the disk is

## 7. Opt-out and privacy checks

- [ ] (Once AT can deliver replies) reply **STOP** from phone A: both patients on A become "does not want SMS"
- [ ] `sudo journalctl -u acisi --since "1 hour ago" | grep -E "07[0-9]{8}|2547[0-9]{8}"` finds nothing
- [ ] Owner site → Activity shows the lookups, record requests, approvals, revocations and file views,
      with who did each and at which clinic. To see the patient on each row too:
      `sudo -u postgres psql acisi -c 'select "createdAt", action, "clinicId", "patientId" from audit_logs order by "createdAt" desc limit 30'`

## Before real patients

- [ ] Delete the test patients (owner site → Delete patient)
- [ ] Switch `AT_USERNAME`/`AT_API_KEY` to live, restart, and send yourself one registration SMS
- [ ] Turn on `SMS_REPLY_STOP_ENABLED` only after Africa's Talking confirms replies reach us
