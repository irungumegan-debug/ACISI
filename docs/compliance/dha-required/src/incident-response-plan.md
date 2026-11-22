## 1. Purpose and scope

This plan sets out how ACISI Healthcare responds to security incidents and personal data breaches affecting the ACISI system. It applies to the production system, its server and backups, and the providers ACISI uses.

## 2. Response team

| Role | Name | Contact |
|---|---|---|
| Incident lead and Data Protection Officer | Megan Irungu, Founder | 0746404155, acisi.help@gmail.com |
| Hosting provider | HostAfrica | Support ticket in the client area |
| Affected clinics | Clinic administrator | As recorded in ACISI |

## 3. What is an incident

- A personal data breach: data lost, stolen, changed, or seen by someone who should not see it.
- Unauthorised access to the system or server.
- Malware or ransomware.
- A lost or stolen device with an active ACISI login.
- The system being unavailable for clinics.

### Severity

| Level | Example | Response |
|---|---|---|
| Critical | Patient data exposed, server compromised, ransomware | Immediately |
| High | Stolen staff login, system down during clinic hours | Within 1 hour |
| Medium | Suspicious access, failed backup | Same day |
| Low | Isolated error with no data affected | Within 1 week |

## 4. Response steps

1. **Report.** Anyone who notices an incident tells the founder at once by phone.
2. **Assess.** The founder confirms what happened, which data and which clinics are affected, and sets the severity.
3. **Contain.** Stop the harm: lock the affected accounts, change PINs and keys, block access, or take the server offline.
4. **Investigate.** Use the audit log and server logs to find the cause and the full extent.
5. **Notify.** Tell the people below within the time limits.
6. **Recover.** Fix the cause. Restore from backup if needed, per the Disaster Recovery Plan.
7. **Review.** Record what happened and what was changed to stop it happening again.

## 5. Notification

| Who | When | How |
|---|---|---|
| Affected clinic | Within 48 hours of becoming aware | Phone and email |
| Office of the Data Protection Commissioner | Within 72 hours, by the data controller | ODPC breach notification |
| Digital Health Agency | Within 48 hours for incidents affecting the system or health data | Email |
| Affected patients | Without delay when they are at real risk | Through the clinic, by phone or SMS |

The clinic is the data controller for its patients' records and notifies the ODPC with ACISI's help. ACISI notifies the ODPC for its own data.

## 6. Common incidents

| Incident | First actions |
|---|---|
| Staff device lost or stolen | Deactivate the staff account; reset PIN and authenticator; check the audit log for that account |
| Staff login stolen | Lock the account; reset PIN and authenticator; review what was viewed |
| Records seen by the wrong clinic or person | Stop the access; identify the records; notify as above |
| Server compromised or ransomware | Take the server offline; build a clean server; restore the last clean backup; change all keys |
| System down | Clinics switch to paper registers; restore service per the Disaster Recovery Plan |
| SMS sent to the wrong number | Identify the message; inform the patient through the clinic |

## 7. Records

Every incident is recorded with: date and time, what happened, data and people affected, actions taken, notifications made, and what was changed. Records are kept for 5 years.

## 8. Review

This plan is reviewed every year and after every critical or high incident.
