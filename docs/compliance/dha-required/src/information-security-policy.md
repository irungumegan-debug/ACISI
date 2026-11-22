## 1. Purpose and scope

This policy sets how ACISI Healthcare protects the ACISI system and the personal and health data in it. It covers the production system at acisi.co.ke, its server and backups, everyone with access, and the providers ACISI uses.

It follows the Data Protection Act, 2019, the Data Protection (General) Regulations, 2021 and the Digital Health Act, 2023.

## 2. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Founder and Data Protection Officer, Megan Irungu | Owns this policy; security of the system; data protection compliance; incidents; reporting to ODPC and DHA |
| Clinic administrators | Add and remove their clinic's staff; keep staff lists up to date |
| Clinic staff | Keep their PIN secret; use only what their role needs; report anything suspicious |
| Providers: HostAfrica, Safaricom, Mobile Sasa, Cloudflare | Services under their own security obligations |

## 3. Access control

- Every user has a personal account. Shared accounts are not allowed.
- Five roles: front desk, clinician, doctor, lab technician and clinic administrator. Each sees only what the role needs.
- Doctors see only patients in their own department queue. Lab technicians see only lab requests.
- Each clinic sees only its own patients. Another clinic can see a patient's records only with the patient's consent or a same-day code.
- Clinic administrators deactivate staff who leave on the day they leave.
- Server access is limited to the founder.

## 4. Login and passwords

- Staff log in with a personal staff ID and a 6-digit PIN. Weak PINs are refused.
- After 5 wrong PINs the account locks for 5 minutes.
- Clinic administrators and doctors also use an authenticator app.
- Users are logged out after 15 minutes without activity. Sessions end after 8 hours at most.
- PINs are never stored, only a secure hash.
- Doctors sign consultations, and lab technicians sign results, by entering their PIN again. Signed records cannot be changed.

## 5. Data protection

- Only the minimum data is collected. Patient address and location are not collected.
- Health data, ID numbers, next-of-kin details and uploaded files are encrypted with AES-256.
- All traffic uses HTTPS.
- All patient data is stored and processed in Kenya.
- SMS messages never contain diagnoses or test results.
- Encryption keys are kept on the server, readable by the administrator only, with an offline copy.

## 6. Server and network security

- The server is hosted by HostAfrica in Kenya.
- The firewall allows only ports 22, 80 and 443.
- Administrator login uses a security key only. Passwords and root login are switched off.
- Repeated failed logins are blocked automatically.
- Security updates install automatically.
- The database and session store cannot be reached from outside the server.

## 7. Logging and monitoring

- Logins, record views, exports and changes are recorded in an audit log.
- The audit log cannot be edited or deleted, and tampering is detectable.
- The integrity of the audit log is checked monthly.
- The founder reviews the audit log weekly for unusual access.

## 8. Backup and recovery

- Encrypted backups are taken every night and kept 14 days.
- A restore test is run monthly. The last test passed on 22 November 2026.
- Details are in the Backup and Recovery Policy and the Disaster Recovery Plan.

## 9. Providers

- Providers are used only where needed and receive the minimum data.
- Patient data must stay in Kenya. A provider that would store patient data outside Kenya is not used.
- Clinics sign a Data Processing Agreement with ACISI.

## 10. Staff and clinics

- Every staff member accepts the Confidentiality Undertaking before first use.
- Clinics are responsible for their own devices and internet connection.
- Staff must lock or log out of shared computers.

## 11. Changes to the system

- Every change is tested before release.
- The founder approves every release.
- A full backup is taken before each release.

## 12. Incidents

Security incidents and data breaches are handled under the Incident Response Plan. The affected clinic is told within 48 hours, and the ODPC within 72 hours.

## 13. Review

This policy is reviewed every year.
