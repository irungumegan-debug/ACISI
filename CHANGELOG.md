# Changelog

Plain-language record of what changed in ACISI, which data each change
touches, and who can use it. Newest first.

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
