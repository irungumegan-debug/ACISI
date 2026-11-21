import sys, copy, docx
from docx.shared import Pt, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
src, imgdir, out = sys.argv[1:4]
d = docx.Document(src)
P, T = d.paragraphs, d.tables
SZ = Pt(9.5)

def put(cell, text, bold=False):
    """Replace a cell's text; '\n' starts a new paragraph in the cell."""
    paras = cell.paragraphs
    first = paras[0]
    size = next((r.font.size for r in first.runs if r.font.size), SZ)
    for p in paras[1:]:
        p._p.getparent().remove(p._p)
    for r in first.runs[1:]:
        r._r.getparent().remove(r._r)
    lines = text.split('\n')
    run = first.runs[0] if first.runs else first.add_run()
    run.text = lines[0]; run.font.size = size
    if bold: run.bold = True
    for ln in lines[1:]:
        np_ = copy.deepcopy(first._p)
        cell._tc.append(np_)
        p = cell.paragraphs[-1]
        p.runs[0].text = ln
        for r in p.runs[1:]: r._r.getparent().remove(r._r)

def para_text(p, text):
    for r in p.runs[1:]: r._r.getparent().remove(r._r)
    p.runs[0].text = text; p.runs[0].italic = False

def after(p, texts):
    """Insert body paragraphs after p, copying its formatting."""
    cur = p
    for t in texts:
        np_ = copy.deepcopy(p._p)
        cur._p.addnext(np_)
        cur = docx.text.paragraph.Paragraph(np_, p._parent)
        para_text(cur, t)
    return cur

def value(p, text):
    """'Label:  ____' paragraphs: keep the bold label, replace the rest."""
    for r in p.runs[2:]: r._r.getparent().remove(r._r)
    p.runs[1].text = text

def figure(tbl, img, caption_p, caption):
    cell = tbl.rows[0].cells[0]
    for pp in cell.paragraphs[1:]: pp._p.getparent().remove(pp._p)
    p0 = cell.paragraphs[0]
    for r in p0.runs: r._r.getparent().remove(r._r)
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p0.add_run().add_picture(img, width=Emu(int(5760720 * 0.95)))
    para_text(caption_p, caption)

def fill_rows(tbl, rows, start=1):
    while len(tbl.rows) < start + len(rows):
        tbl._tbl.append(copy.deepcopy(tbl.rows[-1]._tr))
    for i, vals in enumerate(rows):
        for j, v in enumerate(vals):
            if v is not None: put(tbl.rows[start + i].cells[j], v)

OWNER = 'ACISI (Megan Irungu)'
# 0. Identification
for i, v in enumerate(['System Architecture Document', 'ACISI-SAD-2026-01 (DHA application DHS-1793019691629-GXVFAJJTJ)', '1.0', 'CONFIDENTIAL', 'FINAL',
                       'ACISI clinic management system (acisi.co.ke)', 'ACISI Healthcare (business name registration BN-L3SMWLDM), Kenya',
                       'Megan Irungu, Founder and Data Protection Officer', 'Megan Irungu, Founder (with ACISI engineering)', '21 November 2026', '21 November 2027, or sooner after any major change']):
    put(T[1].rows[i].cells[1], v)

# 1. Executive summary
para_text(P[6], "ACISI is a web-based clinic management system for small outpatient clinics in Kenya. Patients check in from home or at the front desk and join a queue; doctors record coded diagnoses (WHO ICD-11), structured prescriptions, lab requests, vital signs and a care plan; the clinic takes payment at checkout; and the system produces the Ministry of Health's surveillance and routine reports.")
after(P[6], [
 "ACISI is built as one application (a modular monolith) on a single virtual server in a HostAfrica data centre in Nairobi, so all patient data is stored and processed in Kenya, as the Data Protection Act, 2019 and the Digital Health Act, 2023 require.",
 "The principal design decisions are: keep the system simple to run and secure for a small team (one server, one database, documented manual procedures); protect health data with HTTPS in transit and AES-256-GCM encryption at rest; record every view and change in a tamper-evident, append-only audit log; give each user a personal login with role-based access and authenticator-app multi-factor login for administrators and doctors; and use international standards (HL7 FHIR R4, ICD-11, LOINC, DHA ePrescription codes) so records can be exchanged with Kenya's Health Information Exchange once DHA issues credentials.",
 "Known limits, each with a plan in this document: a single server with no automatic failover, backups kept on the same server until an off-server copy in Kenya is set up, no external uptime alerting yet, and no automated build pipeline or separate staging server yet."])

# 2.1 System description
para_text(P[10], "What it does. ACISI covers the outpatient visit from start to finish: patient registration with identity documents and duplicate checks; remote check-in (with a small M-Pesa check-in fee) and walk-in check-in; department queues; consultation notes signed with the doctor's PIN and locked after signing; ICD-11 coded diagnoses (1 to 5 per visit); structured prescriptions with allergy warnings; lab requests and signed results with critical-value alerts; vital signs with age-adjusted warnings and BMI; other service orders (radiology, physiotherapy, nutrition, counselling and more); problem list and family history; dispensing; billing and payment at checkout; and receipts and visit summaries by SMS.")
after(P[10], [
 "Who uses it. Clinic staff use the staff console (/console) with five roles: front desk, clinician, doctor, lab technician and clinic administrator. Each role sees only what it needs; doctors see only their own department's queue. Patients use the patient portal (/) to check in, pay the check-in fee, see their visits and manage SMS choices; USSD access is planned. The ACISI owner uses a separate owner site (/owner) to onboard clinics and run the platform. Many clinics share one installation; every record carries its clinic, and every query is limited to the logged-in user's clinic.",
 "Business processes supported. (1) Registration and check-in; (2) consultation, ordering and prescribing; (3) laboratory work; (4) dispensing, billing and payment; (5) disease surveillance: immediate alerts for notifiable diseases (IDSR Technical Guidelines, 3rd ed., 2022), the weekly MOH 505 summary, public health events and IHR flags; (6) routine monthly, quarterly and annual reports and quality measures; (7) sharing a patient's history between clinics only with the patient's consent; (8) exchange with the national HIE (Client Registry, Facility Registry, Health Worker Registry, Shared Health Record), built and switched off until DHA issues credentials.",
 "Data held. Patient identity and contact details, next of kin, visit and clinical records, payments, staff accounts and the audit log. Patient residence/address and location are deliberately not collected."])

# 2.2 / 3.2 / 5.1 / 6.2 / 8.3 figures
figure(T[2], f'{imgdir}/context.png', P[14], 'Figure 2.2: Business context diagram. Solid lines are live today; dashed lines are built but switched off, or carried out by clinic staff.')
figure(T[4], f'{imgdir}/highlevel.png', P[27], 'Figure 3.2: High-level architecture. Everything in the green zone runs on one server in Nairobi.')
figure(T[6], f'{imgdir}/dfd.png', P[34], 'Figure 5.1: Level 1 data flow. All flows are encrypted (HTTPS, TLS 1.2 or 1.3). Dashed flows are not yet live or are done by clinic staff.')
figure(T[9], f'{imgdir}/network.png', P[43], 'Figure 6.2: Network security architecture. Only ports 22, 80 and 443 are reachable from the internet.')
figure(T[12], f'{imgdir}/cicd.png', P[62], 'Figure 8.3: Delivery pipeline (manual, documented release).')

# 2.3 boundaries
fill_rows(T[3], [
 ['ACISI application: web apps, API, background workers, FHIR interface, database, uploaded files, backups', 'All ACISI code and configuration; data stored by ACISI; security of the application and server configuration', "Clinics' own computers, phones, printers and internet connection", OWNER],
 ['Hosting infrastructure', 'Server operating system and its hardening, firewall, Nginx, PostgreSQL, Redis (configured by ACISI)', 'Physical data centre, power, hypervisor and network up to the server', 'HostAfrica (provider); ACISI for the server set-up'],
 ['Payments', 'Starting the M-Pesa STK push, receiving the result, recording payments and receipts', 'M-Pesa processing and wallets; card processing by the clinic\'s own card provider', 'Safaricom (M-Pesa); the clinic for its till and card machine'],
 ['Messaging and national systems', 'Writing SMS text; the HIE client; producing IDSR and routine reports', 'SMS delivery network; DHA registries and Shared Health Record; submitting reports to KHIS/eIDSR (done by the clinic)', "Africa's Talking; DHA; Ministry of Health / Sub-County"],
])

# 3.1 style
value(P[20], 'Monolith (modular: one Node.js application, with event-driven background jobs on a Redis queue)')
value(P[21], 'Cloud (one virtual private server, infrastructure as a service)')
value(P[22], 'HostAfrica (virtual private server)')
value(P[23], 'Nairobi, Kenya (HostAfrica data centre). All patient data is stored and processed in Kenya.')

# 4. components
fill_rows(T[5], [
 ['API Gateway (reverse proxy)', 'Network', "Nginx (Ubuntu 24.04 package), Let's Encrypt certificate", 'TLS termination, HTTP to HTTPS redirect, security headers (HSTS, CSP), request size limits, proxy to the app. No separate API gateway product.', OWNER, 'Application', 'Critical'],
 ['Auth Service', 'Service', 'Module in the app: bcrypt, TOTP (RFC 6238), sessions in Redis', 'Personal PIN logins, lockout after 5 wrong tries, authenticator-app MFA for admins and doctors, role-based access, 15-minute inactivity logoff', OWNER, 'Application', 'Critical'],
 ['Web Application', 'Frontend', 'React 18, Vite 6, TypeScript (3 single-page apps)', 'Patient portal, staff console, owner site; served by the app over HTTPS', OWNER, 'Presentation', 'High'],
 ['Database', 'Data Store', 'PostgreSQL 18, Prisma 5 ORM', 'Primary data store; health fields encrypted (AES-256-GCM); audit log is append-only and hash-chained', OWNER, 'Data', 'Critical'],
 ['Message Queue', 'Middleware', 'Redis + BullMQ 5', 'Background jobs: SMS, M-Pesa status checks, HIE sending, maintenance, report emails; retries', OWNER, 'Application', 'High'],
 ['CDN', 'Network', 'None (Cloudflare used for DNS only, proxy off)', 'Not used: a CDN would decrypt traffic outside Kenya. Static files are served from the server in Nairobi.', OWNER, 'Presentation', 'Low'],
 ['File / Object Store', 'Data Store', 'Local disk /var/lib/acisi/uploads, AES-256-GCM', 'Patient files (scans, photos of paper records), encrypted, random names, outside the web root', OWNER, 'Data', 'High'],
 ['Cache Layer', 'Data Store', 'Redis (64 MB, localhost only, saved to disk)', 'Sessions, login rate limits, job queues', OWNER, 'Application', 'High'],
 ['Monitoring Stack', 'Operations', 'pino logs to the systemd journal; /healthz endpoint', 'Application and access logs; health check. External uptime alerting not yet in place (gap G6, planned Dec 2026).', OWNER, 'Operations', 'High'],
 ['CI/CD Pipeline', 'DevOps', 'GitHub, Jest, ESLint, TypeScript compiler; runbook-driven release', 'Tests and checks before each merge; manual, documented release to the server. Automated CI planned.', OWNER, 'Operations', 'Medium'],
 ['Backup Service', 'Operations', 'pg_dump + age encryption, systemd timer', 'Nightly encrypted backups of database and files at 02:00 EAT, kept 14 days; practice restore script (to run monthly)', OWNER, 'Data', 'Critical'],
 ['FHIR R4 interface and HIE client', 'Service', 'Module in the app (/fhir/r4, src/hie)', 'Standards-based exchange (Kenya Core, Patient Summary, ePrescription guides); HIE registries and Shared Health Record. HIE off until DHA credentials.', OWNER, 'Application', 'High'],
])

# 5.2 integrations
fill_rows(T[7], [
 ['Safaricom M-Pesa (Daraja)', 'Outbound + inbound callback', 'REST (JSON)', 'Amount, phone number, account reference; payment result and M-Pesa receipt number', 'OAuth 2.0 client credentials plus shortcode passkey; status query if no callback arrives', 'TLS 1.2+', 'Safaricom; ACISI', 'Safaricom service terms. Live for the check-in fee since 20 Nov 2026'],
 ["Africa's Talking SMS", 'Outbound', 'REST (JSON)', 'Phone number and SMS text (no diagnoses)', 'API key in server settings', 'TLS 1.2+', "Africa's Talking; ACISI", 'Provider terms. Sandbox today; production sender ID pending'],
 ['DHA Health Information Exchange', 'Outbound (and reads)', 'REST, HL7 FHIR R4', 'Client Registry lookups, facility and practitioner lookups, Shared Health Record bundles (only with the patient\'s consent per visit)', 'OAuth 2.0 client credentials token; facility headers; consent token', 'TLS 1.2+', 'DHA; ACISI', 'DHA terms. Built, off until DHA credentials (gap G2)'],
 ['FHIR R4 API (/fhir/r4)', 'Inbound', 'REST, HL7 FHIR R4', 'Patient, Encounter, Condition, MedicationRequest, Observation, ServiceRequest and others', 'Logged-in doctor session; anonymous requests refused', 'TLS 1.2/1.3', OWNER, 'Same as the main system'],
 ['Resend email (surveillance reports)', 'Outbound', 'REST (JSON)', 'Clinic name, disease names and counts only; no patient details', 'API key in server settings', 'TLS 1.2+', 'Resend; ACISI', 'Off: not configured, to keep data in Kenya'],
])

# 6.1 defence in depth
for i, (ctrl, std, st) in enumerate([
 ('Cloudflare DNS only (no proxy, to keep traffic in Kenya); firewall allows only ports 22, 80 and 443; HTTPS only with HSTS; request size limits. No WAF or DDoS service yet.', 'OWASP, CIS', 'Partly in place (WAF/DDoS: not in place)'),
 ('Host firewall (ufw), fail2ban on SSH, database and Redis listen on localhost only, SSH by key only with root and password logins off. No NIDS or VPN.', 'CIS Ubuntu 24.04 (selected controls)', 'In place (NIDS/VPN: not in place)'),
 ('Request validation (zod), parameterised database access (Prisma), Content Security Policy and security headers, SameSite session cookies, rate limits on logins, ~1,260 automated tests, code review before merge.', 'OWASP Top 10, OWASP ASVS (informal)', 'In place'),
 ('Personal logins, bcrypt-hashed PINs, lockout after 5 wrong tries, 5 roles with least privilege, authenticator-app MFA for admins and doctors, 15-minute inactivity logoff, session expiry, server admin by named SSH key.', 'NIST SP 800-63B (selected)', 'In place; MFA built, being switched on (gap G1)'),
 ('HTTPS (TLS 1.2/1.3) in transit; AES-256-GCM for health fields, ID numbers, next of kin and uploaded files; key kept outside the database and offline; encrypted backups; data kept in Kenya; minimal data in SMS.', 'ISO/IEC 27001 Annex A (selected), Data Protection Act 2019', 'In place (off-server backup copy: gap G5)'),
 ('Automatic security updates on the server; staff devices are the clinics\' own. No EDR or device management.', 'CIS (selected)', 'Partly in place'),
 ('Tamper-evident audit log of every view and change (append-only, hash-chained, verify command); application logs; breach procedure (clinic in 48 h, ODPC in 72 h). No SIEM or 24x7 alerting yet.', 'ISO/IEC 27001, Data Protection Act 2019 s.43', 'Partly in place (uptime alerting: gap G6)'),
], start=1):
    r = T[8].rows[i].cells
    put(r[1], ctrl); put(r[2], std); put(r[3], st)

# 7. availability
value(P[46], '99% monthly target (best effort; single server, no contractual SLA yet). Planned maintenance announced to clinics in advance.')
value(P[47], '24 hours: rebuild a server from the runbook and restore the latest backup.')
value(P[48], '24 hours: nightly backups at 02:00 EAT (at most one day of data lost). Off-server copy in Kenya planned (gap G5).')
for i, (yn, det) in enumerate([
 ('No', 'One server. Nginx forwards to a single application process.'),
 ('No', 'Fixed size VPS (1 vCPU, 1 GB RAM, 2 GB swap); resized manually with the provider when needed.'),
 ('No', 'Single data centre in Nairobi. Recovery is by rebuild and restore (RTO 24 h).'),
 ('No', 'Single PostgreSQL instance. Nightly encrypted backups, 14 days; practice restore into a throwaway database (runbook, monthly).'),
 ('Partly', 'Calls to M-Pesa, SMS and the HIE have time-outs and run as background jobs with retries, so an outside service being down does not stop clinic work.'),
 ('No', 'Not used, to keep traffic in Kenya. Built web files are cached by browsers.'),
 ('Partly', 'Health check at /healthz; systemd restarts the app automatically if it stops. No automatic failover; external uptime alert planned (G6).'),
 ('No', 'Not done. A full restore test is recorded in the DR Test Report.'),
], start=1):
    r = T[10].rows[i].cells
    put(r[1], yn); put(r[2], det)

# 8.1 environments
for i, (infra, url, acc) in enumerate([
 ("Developer's computer: Node.js, PostgreSQL and Redis in Docker Compose; test data only", 'localhost', None),
 ('Automated tests (Jest) on the developer\'s computer, with test databases; manual test checklist', 'localhost', None),
 ('Not in place yet. Releases are checked with the manual test checklist on production after a backup.', 'N/A', 'N/A'),
 ('HostAfrica VPS, Nairobi, Ubuntu 24.04', 'https://acisi.co.ke', None),
 ('Not in place. Recovery by rebuilding a server from the runbook and restoring the encrypted backup.', 'N/A', 'Owner only, on activation'),
], start=1):
    r = T[11].rows[i].cells
    put(r[2], infra); put(r[3], url)
    if acc: put(r[4], acc)

# 8.2 containers
value(P[55], 'None in production (app runs directly under systemd). Docker Compose is used only on the developer\'s computer.')
value(P[56], 'None (systemd service on a single server).')
value(P[57], 'Not applicable.')
value(P[58], 'Not applicable. Dependencies are updated through releases; the server installs security updates automatically.')

# 9. tech stack
fill_rows(T[13], [
 [None, 'React with Vite, TypeScript', '18.3, Vite 6.4', 'MIT', 'Community (Meta)', 'No date announced'],
 [None, 'TypeScript on Node.js', 'TS 5; Node.js 20 or later (confirm on server: node -v)', 'Apache 2.0 / MIT', 'OpenJS Foundation (community)', 'Node 20: Apr 2026; Node 22: Apr 2027; Node 24: Apr 2028'],
 [None, 'Express', '4.22', 'MIT', 'OpenJS Foundation (community)', 'Express 4 maintenance; move to 5 planned'],
 [None, 'Nginx (reverse proxy; no separate gateway)', '1.24 (Ubuntu 24.04)', 'BSD-2-Clause', 'Ubuntu security updates', 'With Ubuntu 24.04 LTS (standard support to 2029)'],
 [None, 'PostgreSQL, Prisma ORM', 'PostgreSQL 18; Prisma 5.20', 'PostgreSQL licence; Apache 2.0', 'PostgreSQL Global Development Group; Prisma (community)', 'PostgreSQL 18: Nov 2030'],
 [None, 'Redis', 'Ubuntu 24.04 package (7.x)', 'BSD-3-Clause (7.2 and earlier)', 'Ubuntu security updates', 'With Ubuntu 24.04 LTS (standard support to 2029)'],
 [None, 'BullMQ on Redis', '5.x', 'MIT', 'Taskforce.sh (community)', 'No date announced'],
 [None, 'Local encrypted disk storage (no object store)', 'N/A', 'N/A', 'N/A', 'N/A'],
 [None, 'Built in (no external identity provider): bcrypt PINs, TOTP MFA', 'bcrypt 6', 'MIT', 'ACISI', 'N/A'],
 [None, 'pino logs, /healthz; external uptime monitor planned', 'pino 9', 'MIT', 'Community', 'N/A'],
 [None, 'systemd journal and the application audit log (no SIEM)', 'Ubuntu 24.04', 'LGPL / ACISI', 'Ubuntu; ACISI', '2029 (Ubuntu 24.04 LTS)'],
 [None, 'None: server built and changed by a written runbook (deploy/RUNBOOK.md) with reference config files', 'N/A', 'N/A', 'ACISI', 'N/A'],
])

# sign-off: names and titles; dates and signatures left for the owner
for cell, desig in [(T[15].rows[0].cells[0], 'Founder'), (T[15].rows[0].cells[1], 'Founder and Data Protection Officer'),
                    (T[15].rows[1].cells[0], 'Founder'), (T[15].rows[1].cells[1], 'Founder and sole proprietor')]:
    for p in cell.paragraphs:
        lab = p.runs[0].text.strip() if p.runs else ''
        if lab.startswith('Name'): p.runs[1].text = 'Megan Irungu'
        elif lab.startswith('Designation'): p.runs[1].text = desig
for p in T[0].rows[0].cells[1].paragraphs:
    for r in p.runs:
        if '[ORG-CODE]' in r.text or '[YYYY]' in r.text:
            r.text = 'Reference: ACISI-SAD-2026-01'
d.save(out)
print('saved', out)
