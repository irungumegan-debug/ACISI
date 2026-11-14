# ACISI production runbook

How the live server is set up and how to look after it. Written for someone
who isn't a server expert: every command is meant to be copied as-is into
`ssh acisi`.

**Never put secrets (passwords, API keys, the backup private key) in this
repository, in a chat, or in a support ticket.**

## What runs where

| Thing | Where |
|---|---|
| Server | HostAfrica VPS, Kenya data centre, `102.68.86.176`, Ubuntu 24.04, 1 vCPU / 1 GB RAM / 2 GB swap |
| Login | `ssh acisi` as `acisiadmin` with your SSH key. Root and password logins are off. Emergency: HostAfrica client area → VNC console (root password) |
| App | `/opt/acisi/app` (a git clone of `main`), runs as the `acisi` user under systemd: `acisi.service` (reference copy: `deploy/systemd/acisi.service`) |
| Settings | `/etc/acisi/acisi.env`, readable by root only. Never committed. Holds `DATA_ENCRYPTION_KEY` (also kept offline with the backup key). |
| Database | PostgreSQL 18, localhost only, database and user `acisi` |
| Redis | localhost only, 64 MB cap, `noeviction`, saved to disk (`appendonly`) |
| Web front door | Nginx + Let's Encrypt for `acisi.co.ke` (reference copy: `deploy/nginx/acisi.conf`) |
| DNS | Cloudflare: `acisi.co.ke` and `www` are **A → 102.68.86.176, DNS only (grey cloud)**. Keep the proxy off: with it on, Cloudflare would decrypt patient traffic outside Kenya. |
| Uploaded patient files | `/var/lib/acisi/uploads` (`FILE_STORAGE_DIR`), owned by `acisi`, mode 0700, random file names. Never under the web root, never in a cloud. |
| Backups | `/var/backups/acisi`, nightly at 02:00 EAT, encrypted, 14 days (see below) |

## Data stays in Kenya

Patient data must be stored and processed only in Kenya.

- Cloudflare proxy stays **off** (DNS only).
- Email (Resend, US) is **off**: `RESEND_API_KEY` is deliberately not set.
- Backups, including any future off-server copy, stay in Kenya.
- Africa's Talking: waiting for their written answer on where SMS content is processed and stored.
- Don't paste real patient data into chats, AI tools, or support tickets.

## Everyday checks

```
systemctl status acisi --no-pager | head -5        # should say "active (running)"
sudo journalctl -u acisi -n 50 --no-pager               # recent app logs
curl -s https://acisi.co.ke/healthz; echo          # {"status":"ok"}
free -h; df -h /                                   # memory and disk
redis-cli info memory | grep used_memory_human     # Redis (cap 64 MB)
systemctl list-timers acisi-backup.timer certbot.timer --no-pager
```

Restart the app: `sudo systemctl restart acisi`

## Site shows "502 Bad Gateway" (Nginx)

Nginx is up but the app behind it isn't answering (stopped, crashed or
restarting). Check in this order:

1. **Disk full?** `df -h /`. If `Use%` is 100%, see the next section. A full
   disk also shows in the app logs as `MISCONF Redis ... unable to persist to disk`.
2. **App running?** `systemctl status acisi --no-pager | head -5`. The
   "since" time shows when it last (re)started.
3. **App errors:** `sudo journalctl -u acisi --since "1 hour ago" --no-pager | grep -i -E "error|fail" | tail -30`
4. **Out of memory?** `sudo journalctl -k --since "2 hours ago" --no-pager | grep -i -E "out of memory|killed process"`

Then `sudo systemctl restart acisi` and check `/healthz` after 15 seconds.

## Disk full

Find the biggest folders, then the big files (these only look):
```
sudo du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -8
sudo du -xh --max-depth=1 /var/log 2>/dev/null | sort -h | tail -8
sudo find /var/log -xdev -type f -size +100M -exec ls -lh {} \;
```
A huge log file (e.g. `/var/log/syslog`) can be emptied safely with
`sudo truncate -s 0 <file>`. Use `truncate`, not `rm`: a deleted file that is
still open keeps using space. **Never delete anything by hand in
`/var/lib/postgresql`, `/var/lib/redis` or `/var/backups/acisi`.**

Afterwards Redis has to be restarted before it accepts writes again:
```
sudo systemctl restart redis-server
sudo systemctl restart acisi
sleep 15; curl -s https://acisi.co.ke/healthz; echo
```

Incident 2026-11-13: `/var/log/syslog` reached 13 GB and filled the disk;
Redis stopped accepting writes and the site returned 502.

## Redis full ("OOM command not allowed")

Logins and background jobs stop working when Redis reaches its 64 MB cap.
Check: `redis-cli info memory | grep -E "used_memory_human|maxmemory_human"`.
See what fills it:
```
redis-cli --scan --pattern 'bull:*' | cut -d: -f2 | sort | uniq -c | sort -rn | head
```
Since 14 Nov 2026 every job queue keeps only its newest 200 finished jobs
(`JOB_RETENTION` in `src/jobs/queue.ts`). To clear old finished jobs by hand,
give Redis room for a moment, clean, and put the cap back:
```
redis-cli config set maxmemory 128mb
sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && node -e "const {Queue}=require(\"bullmq\");const R=require(\"ioredis\");(async()=>{for(const n of [\"stk-status-check\",\"maintenance\",\"sms-receipts\",\"visit-summary-email\",\"clinic-stk-status-check\"]){const q=new Queue(n,{connection:new R(process.env.REDIS_URL,{maxRetriesPerRequest:null})});console.log(n,(await q.clean(0,1000000,\"completed\")).length);await q.close()}process.exit(0)})()"'
redis-cli config set maxmemory 64mb
```
This removes only finished jobs, never logins or jobs still waiting.

## Updating the app (after a pull request is merged)

```
sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
sudo systemctl restart acisi
sleep 15; curl -s https://acisi.co.ke/healthz; echo
```

Database migrations run automatically on start (`prisma migrate deploy`).
If the service files in `deploy/` changed, copy them again (see "Install
or update the backup job").

## Release 2026-10-30: data-protection alignment (one-time steps)

See `CHANGELOG.md` for what changed. Do these once, in order, when this
release is merged. Each command is safe to copy as-is.

1. **Backup first:** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager`
   (should end with "Backup written").
2. **Settings** (`sudo nano /etc/acisi/acisi.env`), add these two lines:
   ```
   USSD_ENABLED=false
   FEE_RESTRICTION_ENABLED=false
   ```
   Both are also the defaults, so this only makes them visible. Turn
   `FEE_RESTRICTION_ENABLED=true` only after the Terms of Service say that
   accounts can be restricted over unpaid fees.
3. **Update the app** (this also runs the database migration on start):
   ```
   sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo journalctl -u acisi -n 30 --no-pager | grep -i -E "migration|error" || true
   ```
4. **Nginx** (new security headers and an access log without query strings):
   ```
   sudo cp /etc/nginx/sites-available/acisi /root/acisi.nginx.before-2026-10-30
   sudo install -m 644 /opt/acisi/app/deploy/nginx/acisi.conf /etc/nginx/sites-available/acisi
   sudo nginx -t && sudo systemctl reload nginx
   curl -sI https://acisi.co.ke | grep -i -E "content-security|x-frame|strict-transport"
   ```
   If `nginx -t` reports an error, nothing changed; put the old file back with
   `sudo cp /root/acisi.nginx.before-2026-10-30 /etc/nginx/sites-available/acisi`.
5. **Remove phone numbers already stored on clinic payments** (preview, then apply):
   ```
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s redact-payment-phones'
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s redact-payment-phones -- --apply'
   ```
   The first prints counts only and changes nothing. Run the second only if
   the counts look right.
6. **Clear old logs** that were written before this release (they can contain
   login tokens and search text):
   ```
   sudo journalctl --rotate && sudo journalctl --vacuum-time=1s
   sudo bash -c 'for f in /var/log/nginx/access.log*; do : > "$f"; done'
   ```
7. **Check:** log in to the console as front desk and as a doctor, and open
   the patient portal. See the manual checklist in the release notes.

Step 3 runs three migrations: `20261030090000_odpc_alignment`,
`20261031090000_clinic_sms_usage` (clinic plan, SMS allowance and SMS
count; every existing clinic starts on Starter, 500 SMS a month) and
`20261101090000_checkin_prompt_resends` (the "Resend prompt" counter on
check-ins; existing check-ins start at 0).

**Undo (only if something goes badly wrong):** deploy the previous version
(`git checkout <previous commit>` in step 3), then undo the migrations,
newest first:
```
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261101090000_checkin_prompt_resends.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261101090000_checkin_prompt_resends'"
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261031090000_clinic_sms_usage.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261031090000_clinic_sms_usage'"
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261030090000_odpc_alignment.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261030090000_odpc_alignment'"
```
Data written into the new columns since the release is lost (including SMS
counts and plan changes); nothing older is touched.

## Release 2026-11-03: ODPC statements, part 2 (one-time steps)

See `CHANGELOG.md` (D1–D5). No settings change.

1. **Backup first:** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager`
2. **Update the app** (runs migration `20261103090000_signup_verify_phone_first` on start):
   ```
   sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo journalctl -u acisi -n 30 --no-pager | grep -i -E "migration|error" || true
   ```
3. **Check:** sign up as a patient (code first, then PIN); as clinic admin,
   see "Deactivate" in Settings → staff; check out a visit and confirm the
   one SMS (Africa's Talking simulator while on sandbox).

**Undo (only if something goes badly wrong):** deploy the previous version,
then:
```
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261103090000_signup_verify_phone_first.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261103090000_signup_verify_phone_first'"
```
Signups still waiting for their PIN at that moment are deleted (the patient
signs up again). Nothing else is touched.

## Release 2026-11-14: patient file uploads (one-time steps)

See `CHANGELOG.md`. Staff, doctors and patients can upload X-rays, scans, lab
reports and photos of paper records. Files are stored on this server only.

1. **Backup first:** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager`
2. **Cap the system log** so it can never fill the disk again (13 Nov outage).
   Skip if `grep maxsize /etc/logrotate.d/rsyslog` already shows `maxsize 200M`:
   ```
   sudo sed -i '/\/var\/log\/syslog/,/}/ s/{/{\n\tmaxsize 200M/' /etc/logrotate.d/rsyslog
   sudo mkdir -p /etc/systemd/system/logrotate.timer.d
   printf '[Timer]\nOnCalendar=\nOnCalendar=hourly\n' | sudo tee /etc/systemd/system/logrotate.timer.d/hourly.conf
   sudo systemctl daemon-reload && sudo systemctl restart logrotate.timer
   ```
3. **Update the app** (runs migration `20261114090000_patient_files` on start):
   ```
   sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
   sudo install -m 644 /opt/acisi/app/deploy/systemd/acisi.service /etc/systemd/system/acisi.service
   sudo systemctl daemon-reload
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo ls -ld /var/lib/acisi
   ```
   The last line should show `drwx------ acisi acisi`. No settings change is
   needed: `FILE_STORAGE_DIR` defaults to `/var/lib/acisi/uploads`.
4. **Nginx** (bigger uploads allowed only on the upload routes):
   ```
   sudo cp /etc/nginx/sites-available/acisi /root/acisi.nginx.before-2026-11-14
   sudo install -m 644 /opt/acisi/app/deploy/nginx/acisi.conf /etc/nginx/sites-available/acisi
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If `nginx -t` reports an error, put the old file back:
   `sudo cp /root/acisi.nginx.before-2026-11-14 /etc/nginx/sites-available/acisi`.
5. **Backup job** (now includes the files): run the commands under "Install or
   update the backup job" below, then `sudo systemctl start acisi-backup`.
6. **Check:** on a test patient's page in the console, upload a PDF and open it;
   photograph two pages and save them as one PDF. The owner Overview shows
   "Uploaded files" with the disk use.

**Undo:** deploy the previous version, then
```
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261114090000_patient_files.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114090000_patient_files'"
```
The file records are removed; the files themselves stay in `/var/lib/acisi/uploads`
until deleted by hand.

## Release 2026-11-14: lab orders (one-time steps)

Do this after "patient file uploads" above (lab printouts are stored as files).
See `CHANGELOG.md` (L1 to L9). No settings change.

1. **Backup first:** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager`
2. **Update the app** (runs migration `20261114100000_lab_orders` on start):
   ```
   sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo journalctl -u acisi -n 30 --no-pager | grep -i -E "migration|error" || true
   ```
3. **Nginx** (the lab's printout upload route): install `deploy/nginx/acisi.conf`
   the same way as step 4 of the file-uploads release.
4. **Check:** as clinic admin, add a test under Settings → Lab tests. Sign up a
   lab technician with the invite code. As a doctor, request the test for a
   test patient; as the lab technician, enter a result and sign; the patient is
   back in the doctor's queue marked "Back from lab"; checkout shows the test
   on the bill.

**Undo:** deploy the previous version, then
```
sudo -u postgres psql acisi -f /opt/acisi/app/prisma/rollback/20261114100000_lab_orders.down.sql
sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114100000_lab_orders'"
```
Lab tests, lab requests and results are deleted; visits at the lab go back to
"with the doctor"; lab technicians are deactivated. Printouts stay on the
patient's record as files.

## Release 2026-11-14 (DHA fixes): encryption at rest, tamper-proof audit log, inactivity logoff, adults-only signup

See `CHANGELOG.md`. Do the steps in order; step 2 must be done **before** the
update, or the app will refuse to start.

1. **Backup first:** `sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 5 --no-pager`
2. **Create the encryption key** and add it to the settings (only once, ever):
   ```
   grep -q '^DATA_ENCRYPTION_KEY=' /etc/acisi/acisi.env && echo "already set: do NOT make a new one" || echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)" | sudo tee -a /etc/acisi/acisi.env >/dev/null
   ```
   Then **save a copy offline now**, next to the backup private key (password
   manager plus a printed copy). Show it once with
   `sudo grep DATA_ENCRYPTION_KEY /etc/acisi/acisi.env`, copy it, then clear the
   screen. **Without this key the encrypted records cannot be read**, even from
   backups. Never change or remove it.
3. **Update the app** (runs migration `20261114120000_audit_log_tamper_resistant`):
   ```
   sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo journalctl -u acisi -n 30 --no-pager | grep -i -E "migration|error|DATA_ENCRYPTION_KEY" || true
   ```
   Everyone is logged out once (sessions now track inactivity).
4. **Encrypt the data already stored** (preview, then apply):
   ```
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s encrypt-existing-data'
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s encrypt-existing-data -- --apply'
   ```
   Running the preview again afterwards should show 0 everywhere.
5. **Check the audit log chain:**
   ```
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s verify-audit-log'
   ```
   It should say "Audit log chain intact".
6. **Check in the app:** open a patient's visit as a doctor (diagnosis readable),
   print a visit record at the front desk, open an uploaded file. Leave a console
   tab untouched for 15 minutes: it logs out and says why.

**Undo:** after step 4, the previous version of the app can no longer read
the encrypted fields, so don't go back to it without help. The audit-log
protection alone can be removed with
`prisma/rollback/20261114120000_audit_log_tamper_resistant.down.sql`.

## Switching ACISI's M-Pesa to production (Buy Goods till)

Do this only after the release that adds `MPESA_TILL_NUMBER` is deployed.
Nothing here prints a key.

1. Backup: `sudo systemctl start acisi-backup`
2. `sudo nano /etc/acisi/acisi.env` and set:
   ```
   MPESA_ENV=production
   MPESA_CONSUMER_KEY=<live key>
   MPESA_CONSUMER_SECRET=<live secret>
   MPESA_SHORTCODE=<the shortcode named in Safaricom's passkey email>
   MPESA_TILL_NUMBER=<till number>
   CHECKIN_FEE_AMOUNT_KES=100
   MPESA_PASSKEY=<live passkey>
   MPESA_CALLBACK_URL=https://acisi.co.ke/api/mpesa/callback
   ```
   With `MPESA_ENV=production` the app **refuses to start** (and the log
   says which setting) if `MPESA_TILL_NUMBER` is missing or equals
   `MPESA_SHORTCODE`, if `MPESA_SHORTCODE` is the sandbox code, if the
   callback is not `https://`, or if `CHECKIN_FEE_AMOUNT_KES` is below 50.
   After a restart, `sudo journalctl -u acisi -n 30 --no-pager | grep -A8 "Invalid environment"`
   shows the reason.
   There is no base-URL setting: `MPESA_ENV=production` selects
   `https://api.safaricom.co.ke`. Clinic checkout prompts switch off by
   themselves on a production server.
3. Check what is set (secrets show only their length):
   ```
   sudo grep -E '^(MPESA_ENV|MPESA_SHORTCODE|MPESA_TILL_NUMBER|MPESA_CALLBACK_URL)=' /etc/acisi/acisi.env
   sudo awk -F= '/^MPESA_(CONSUMER_KEY|CONSUMER_SECRET|PASSKEY)=/{print $1, "length", length($2)}' /etc/acisi/acisi.env
   ```
4. Check the live keys work (expect `200`):
   ```
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; printf "user = \"%s:%s\"\n" "$MPESA_CONSUMER_KEY" "$MPESA_CONSUMER_SECRET" | curl -s -o /dev/null -w "%{http_code}\n" -K - "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"'
   ```
5. Forget the sandbox login token (otherwise it is reused for up to an hour), then restart:
   ```
   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; redis-cli -u "$REDIS_URL" DEL mpesa:access_token'
   sudo systemctl restart acisi
   sleep 15; curl -s https://acisi.co.ke/healthz; echo
   sudo journalctl -u acisi -n 50 --no-pager | grep -iE "invalid environment|daraja" || echo "no config or Daraja errors"
   ```
6. Callback reachable from outside (expect `400`: it is live and refused an empty body):
   `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://acisi.co.ke/api/mpesa/callback -H 'Content-Type: application/json' -d '{}'`
7. Real test: check in from your own phone and pay. Then
   `sudo journalctl -u acisi --since "10 min ago" --no-pager | grep "Check-in payment"`
   should show `"resultCode":0` and `"status":"PAID"` (no phone numbers).
   The M-Pesa SMS should name ACISI's till.

**Back to sandbox:** put the sandbox values back, remove `MPESA_TILL_NUMBER`,
and repeat steps 5–6.

## Backups

**What:** every night at about 02:00 EAT, `acisi-backup` writes encrypted files to
`/var/backups/acisi`:
- `acisi-db-<date>.dump.age`: the whole database
- `acisi-config-<date>.tar.age`: `acisi.env`, the Nginx site and the systemd unit
- `acisi-files-<date>.tar.age`: the uploaded patient files (once any exist)

Database and config backups older than 14 days are deleted, but only after a
successful backup. Only the newest 3 file archives are kept (uploaded files never
change, and each archive is as big as the whole uploads folder). The backup
refuses to run when the disk can't hold it with 1 GB to spare.

**Encryption:** `age`, to the public key in `/etc/acisi/backup-recipients.txt`.
The **private key is not on the server**. It lives in your password manager and
a second safe place (e.g. printed and locked away). Without it, the backups
can't be read. If you lose it, make a new key pair right away (see below):
older backups become unreadable, but newer ones are fine.

**Check backups:**
```
ls -lh /var/backups/acisi
sudo journalctl -u acisi-backup -n 20 --no-pager
```

**Run a backup now:** `sudo systemctl start acisi-backup`

**Practice restore (do this monthly):** it restores into a throwaway database
and compares row counts. The live database is never touched.
```
sudo acisi-restore-test
```
Paste the private key when asked. The key isn't shown on screen or saved to disk.

**Full restore (disaster recovery)**, e.g. onto a rebuilt server. It replaces
the live database, so run the practice restore on that file first. In a root
shell (`sudo -i`):
```
systemctl stop acisi
KEY=$(mktemp -p /run)
read -rsp "Paste the AGE-SECRET-KEY line: " S; echo; printf '%s\n' "$S" > "$KEY"; unset S
runuser -u postgres -- psql -c 'DROP DATABASE acisi WITH (FORCE)' -c 'CREATE DATABASE acisi OWNER acisi'
age -d -i "$KEY" /var/backups/acisi/acisi-db-<date>.dump.age | runuser -u postgres -- pg_restore -d acisi --no-owner --no-privileges --role=acisi --single-transaction --exit-on-error && echo "RESTORE OK"
rm -f "$KEY"
systemctl start acisi
exit
```

**Restore the uploaded files** (after a database restore, in the same root shell,
before `rm -f "$KEY"`):
```
install -d -o acisi -g acisi -m 700 /var/lib/acisi/uploads
age -d -i "$KEY" /var/backups/acisi/acisi-files-<date>.tar.age | tar -C /var/lib/acisi/uploads -xf -
chown -R acisi:acisi /var/lib/acisi/uploads
```

**Off-server copy (prepared, NOT enabled):** HostAfrica's backup add-on will be
added before real patient data. If it snapshots the whole server, nothing else
is needed. If it provides an SSH/SFTP destination, enable the hook in
`deploy/backup/offsite-hook.example.sh`. The destination **must be in Kenya**.

### Install or update the backup job

Files are copied, not linked, so the `acisi` app user can never change what
root runs. Use full paths: `acisiadmin` can't `cd` into `/opt/acisi` (only
`sudo` can read it).
```
D=/opt/acisi/app/deploy
sudo install -m 755 $D/backup/acisi-backup.sh /usr/local/sbin/acisi-backup
sudo install -m 755 $D/backup/acisi-restore-test.sh /usr/local/sbin/acisi-restore-test
sudo install -m 644 $D/systemd/acisi-backup.service $D/systemd/acisi-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now acisi-backup.timer
```

### Make a new backup key pair

```
age-keygen
```
This prints the key pair to the screen only. It saves nothing.
1. Save the `AGE-SECRET-KEY-1...` line in your password manager **and** a second safe place.
   Select it by **dragging** from the first `A` to the end: double-clicking stops at the
   hyphens and copies only the end part. A complete key is 74 characters on one line.
2. Put the `age1...` public key in the server's recipients file:
   `echo 'age1...' | sudo tee /etc/acisi/backup-recipients.txt`
3. Close the terminal window so the private key isn't left in the scrollback.

## HTTPS certificate

Let's Encrypt, renewed automatically by `certbot.timer`, using a Cloudflare API
token that can only edit DNS for acisi.co.ke (`/etc/letsencrypt/cloudflare.ini`,
root only). Check: `sudo certbot certificates` and `sudo certbot renew --dry-run`.

## Security in place

- SSH: key only, no root login, `MaxAuthTries 3` (`/etc/ssh/sshd_config.d/00-acisi-hardening.conf`)
- Firewall (ufw): only 22, 80, 443
- fail2ban on SSH: 5 failures in 10 min → 1 h ban. `sudo fail2ban-client status sshd`
- Automatic security updates (Ubuntu, PostgreSQL, Node.js). If an update needs a reboot,
  the server restarts by itself at **03:30 EAT**, after the 02:00 backup.

## Open items

- **Uptime alerts (not set up yet):** add a free external check that opens
  `https://acisi.co.ke/healthz` every few minutes and emails or texts you if it
  fails (e.g. UptimeRobot or Better Stack). It only ever sees `{"status":"ok"}`,
  never patient data. Add one before real clinics depend on ACISI.
- **USSD:** the Africa's Talking simulator test failed after the move
  ("network is experiencing technical problems"). The callback is
  `https://acisi.co.ke/api/ussd`. Fix before USSD goes live (Dec 2026 / early 2027).
  First check: `sudo grep "/api/ussd" /var/log/nginx/access.log | tail`.
- **Dependency security updates:** critical and high warnings cleared in the
  2026-11-03 release. Left: moderate warnings in `react-router` (needs v7) and in
  development-only tools. Re-run `npm audit` monthly.
- **Railway clean-up (after a week of stable running):** delete the Railway app
  service, **both** Postgres services and Redis, then the two `_railway-verify`
  TXT records in Cloudflare. Then delete `/var/lib/acisi-migration` on the server.
- **Africa's Talking:** record their written answer on where SMS content is processed.
