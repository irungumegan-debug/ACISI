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
| Settings | `/etc/acisi/acisi.env`, readable by root only. Never committed. |
| Database | PostgreSQL 18, localhost only, database and user `acisi` |
| Redis | localhost only, 64 MB cap, `noeviction`, saved to disk (`appendonly`) |
| Web front door | Nginx + Let's Encrypt for `acisi.co.ke` (reference copy: `deploy/nginx/acisi.conf`) |
| DNS | Cloudflare: `acisi.co.ke` and `www` are **A → 102.68.86.176, DNS only (grey cloud)**. Keep the proxy off: with it on, Cloudflare would decrypt patient traffic outside Kenya. |
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
journalctl -u acisi -n 50 --no-pager               # recent app logs
curl -s https://acisi.co.ke/healthz; echo          # {"status":"ok"}
free -h; df -h /                                   # memory and disk
systemctl list-timers acisi-backup.timer certbot.timer --no-pager
```

Restart the app: `sudo systemctl restart acisi`

## Updating the app (after a pull request is merged)

```
sudo -u acisi -H bash -c 'cd /opt/acisi/app && git pull && npm ci && npm run build'
sudo systemctl restart acisi
sleep 15; curl -s https://acisi.co.ke/healthz; echo
```

Database migrations run automatically on start (`prisma migrate deploy`).
If the service files in `deploy/` changed, copy them again (see "Install
or update the backup job").

## Backups

**What:** every night at about 02:00 EAT, `acisi-backup` writes two encrypted files to
`/var/backups/acisi`:
- `acisi-db-<date>.dump.age`: the whole database
- `acisi-config-<date>.tar.age`: `acisi.env`, the Nginx site and the systemd unit

Files older than 14 days are deleted, but only after a successful backup.

**Encryption:** `age`, to the public key in `/etc/acisi/backup-recipients.txt`.
The **private key is not on the server**. It lives in your password manager and
a second safe place (e.g. printed and locked away). Without it, the backups
can't be read. If you lose it, make a new key pair right away (see below):
older backups become unreadable, but newer ones are fine.

**Check backups:**
```
ls -lh /var/backups/acisi
journalctl -u acisi-backup -n 20 --no-pager
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

**Off-server copy (prepared, NOT enabled):** HostAfrica's backup add-on will be
added before real patient data. If it snapshots the whole server, nothing else
is needed. If it provides an SSH/SFTP destination, enable the hook in
`deploy/backup/offsite-hook.example.sh`. The destination **must be in Kenya**.

### Install or update the backup job

Files are copied, not linked, so the `acisi` app user can never change what
root runs.
```
cd /opt/acisi/app/deploy
sudo install -m 755 backup/acisi-backup.sh /usr/local/sbin/acisi-backup
sudo install -m 755 backup/acisi-restore-test.sh /usr/local/sbin/acisi-restore-test
sudo install -m 644 systemd/acisi-backup.service systemd/acisi-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now acisi-backup.timer
```

### Make a new backup key pair

```
age-keygen
```
This prints the key pair to the screen only. It saves nothing.
1. Save the `AGE-SECRET-KEY-1...` line in your password manager **and** a second safe place.
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
- **Dependency security updates:** `npm audit` reports issues in `qs`, `express`,
  `proxy-addr`, `axios` and others. Update in a pull request, before real patient data.
- **Railway clean-up (after a week of stable running):** delete the Railway app
  service, **both** Postgres services and Redis, then the two `_railway-verify`
  TXT records in Cloudflare. Then delete `/var/lib/acisi-migration` on the server.
- **Africa's Talking:** record their written answer on where SMS content is processed.
