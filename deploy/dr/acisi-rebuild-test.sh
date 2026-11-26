#!/usr/bin/env bash
# Step 2 of the full rebuild test (DR Test Report: "RTO — Core application"
# and "RTO — Overall"). Run as root on a FRESH Ubuntu 24.04 server in Kenya
# (the Angani standby). Rebuilds ACISI from nothing using only the encrypted
# backup and the app code sent by acisi-dr-send.sh, times every step, checks
# the data, then deletes the decrypted copy again.
#
# It is a TEST copy: it never takes over acisi.co.ke, can't be reached from
# outside, and can't send SMS, M-Pesa prompts, email or HIE requests (those
# settings are switched off before it starts).
#
# Usage: sudo bash acisi-rebuild-test.sh ~/acisi-dr
set -euo pipefail
umask 077

SRC=$(readlink -f "${1:?Usage: sudo bash acisi-rebuild-test.sh ~/acisi-dr}")
TEST_PORT=3999
REPORT=/root/acisi-rebuild-test-$(date +%Y%m%d-%H%M).txt
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
grep -q 'VERSION_ID="24.04"' /etc/os-release || { echo "Needs Ubuntu 24.04." >&2; exit 1; }
if systemctl is-active --quiet acisi 2>/dev/null; then echo "ACISI is already running here: this script is for a test server only." >&2; exit 1; fi
db=$(find "$SRC" -maxdepth 1 -name 'acisi-db-*.dump.age' | sort | tail -n 1)
cfg=$(find "$SRC" -maxdepth 1 -name 'acisi-config-*.tar.age' | sort | tail -n 1)
files=$(find "$SRC" -maxdepth 1 -name 'acisi-files-*.tar.age' | sort | tail -n 1)
[[ -n $db && -n $cfg && -f $SRC/acisi-app.tar.gz ]] || { echo "Backup or app code missing in $SRC: run acisi-dr-send.sh on the main server first." >&2; exit 1; }

exec > >(tee -a "$REPORT") 2>&1
now() { date +%s; }
stamp() { date '+%d %b %Y %H:%M:%S %Z'; }
mins() { printf '%dm %02ds' $(($1 / 60)) $(($1 % 60)); }
echo "ACISI full rebuild test, $(stamp), on $(hostname)"
echo "Backup: $(basename "$db"); app commit: $(cat "$SRC/app-commit.txt" 2>/dev/null || echo unknown)"
T0=$(now)

echo "=== 1. Install system software ($(stamp))"
# Package keys and lists must be readable by apt's own user: normal file
# permissions for this step only (the data steps below stay root-only).
umask 022
export DEBIAN_FRONTEND=noninteractive
# Undo a failed earlier run that left root-only package keys behind.
chmod 644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg /usr/share/keyrings/nodesource.gpg 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg age git build-essential python3 redis-server postgresql-common >/dev/null
# PostgreSQL's own repository, set up with its official script.
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
apt-get install -y -qq postgresql-18 nodejs >/dev/null
umask 077
T1=$(now); echo " RESULT: done in $(mins $((T1 - T0))) (node $(node -v), $(psql --version | awk '{print $3}'))"

echo "=== 2. Backup key and settings ($(stamp))"
key=$(mktemp -p /run acisi-backup-key.XXXXXX)
work=$(mktemp -d -p /run acisi-dr.XXXXXX)
trap 'rm -rf "$key" "$work"' EXIT
echo "Paste the backup private key (the AGE-SECRET-KEY-1... line), then press Enter:"
secret=""
while IFS= read -rs line </dev/tty; do
  line=$(tr -d '[:space:]' <<<"$line")
  [[ -z $line || $line == \#* ]] && continue
  secret=$line; break
done
if [[ $secret == *AGE-SECRET-KEY-1* ]]; then secret="AGE-SECRET-KEY-1${secret#*AGE-SECRET-KEY-1}"; fi
if [[ $secret == age1* ]]; then echo "That is the PUBLIC key (age1...). Paste the line starting AGE-SECRET-KEY-1." >&2; exit 1; fi
if [[ $secret != AGE-SECRET-KEY-1* && ! $secret =~ ^1[02-9ACDEFGHJ-NP-Z]{58}$ ]]; then echo "Not recognised: ${#secret} characters received, starting '${secret:0:4}'. The key line is 74 characters and starts AGE-SECRET-KEY-1." >&2; exit 1; fi
secret=$(tr -d '[:space:]' <<<"$secret")
[[ $secret =~ ^1[02-9ACDEFGHJ-NP-Z]{58}$ ]] && secret="AGE-SECRET-KEY-$secret"
[[ $secret == AGE-SECRET-KEY-1* ]] || { echo "That isn't the backup PRIVATE key (AGE-SECRET-KEY-1...)." >&2; exit 1; }
printf '%s\n' "$secret" >"$key"; unset secret
TK=$(now)  # time spent waiting for the key is not counted below
age --decrypt -i "$key" "$cfg" | tar -C "$work" -xf -
install -d -m 700 /etc/acisi
cp "$work/etc/acisi/acisi.env" /etc/acisi/acisi.env
cat >>/etc/acisi/acisi.env <<'OVERRIDES'

# ---- DR TEST COPY (acisi-rebuild-test.sh): nothing may leave this server ----
NODE_ENV=production
PORT=3999
MOBILESASA_API_TOKEN=
AT_USERNAME=sandbox
AT_API_KEY=disabled-dr-test
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=disabled-dr-test
MPESA_CONSUMER_SECRET=disabled-dr-test
MPESA_PASSKEY=disabled-dr-test
CLINIC_DARAJA_CONSUMER_KEY=
CLINIC_DARAJA_CONSUMER_SECRET=
RESEND_API_KEY=
HIE_ENABLED=false
SHA_ENABLED=false
USSD_ENABLED=false
OVERRIDES
chmod 600 /etc/acisi/acisi.env
# Nobody outside this server can reach the test copy.
iptables -C INPUT -p tcp --dport $TEST_PORT ! -i lo -j DROP 2>/dev/null || iptables -I INPUT -p tcp --dport $TEST_PORT ! -i lo -j DROP
# Redis as on the live server: same password (if any), 64 MB, never evicts queued jobs.
rurl=$(grep -E '^REDIS_URL=' "$work/etc/acisi/acisi.env" | tail -n 1 | cut -d= -f2- | tr -d '"')
rpass=$(sed -nE 's#^rediss?://[^:@/]*:([^@]+)@.*#\1#p' <<<"$rurl")
rpass=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$rpass")
{
  echo "maxmemory 64mb"
  echo "maxmemory-policy noeviction"
  if [[ -n $rpass ]]; then echo "requirepass $rpass"; fi
} >/etc/redis/acisi-dr.conf
chmod 640 /etc/redis/acisi-dr.conf; chown redis:redis /etc/redis/acisi-dr.conf
grep -q '^include /etc/redis/acisi-dr.conf' /etc/redis/redis.conf || echo 'include /etc/redis/acisi-dr.conf' >>/etc/redis/redis.conf
systemctl restart redis-server
echo " RESULT: settings restored; SMS, M-Pesa, email and HIE switched off; port $TEST_PORT closed to the outside"

echo "=== 3. Database restore ($(stamp))"
url=$(grep -E '^DATABASE_URL=' "$work/etc/acisi/acisi.env" | tail -n 1 | cut -d= -f2- | tr -d '"')
dbuser=$(sed -E 's#^postgres(ql)?://([^:]+):.*#\2#' <<<"$url")
dbpass=$(sed -E 's#^postgres(ql)?://[^:]+:([^@]*)@.*#\2#' <<<"$url")
dbname=$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$url")
urldecode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
dbpass=$(urldecode "$dbpass")
pg() { runuser -u postgres -- "$@"; }
pg psql -qc "DO \$\$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$dbuser') THEN CREATE ROLE \"$dbuser\" LOGIN; END IF; END\$\$;"
pg psql -qc "ALTER ROLE \"$dbuser\" PASSWORD '${dbpass//\'/\'\'}';"
pg dropdb --if-exists "$dbname"; pg createdb -O "$dbuser" "$dbname"
age --decrypt -i "$key" "$db" | pg pg_restore --no-owner --role="$dbuser" --exit-on-error -d "$dbname"
T3=$(now); echo " RESULT: restored in $(mins $((T3 - TK)))"

echo "=== 4. Patient files restore ($(stamp))"
id acisi >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/acisi --shell /usr/sbin/nologin acisi
install -d -o acisi -g acisi -m 700 /var/lib/acisi /var/lib/acisi/uploads
if [[ -n $files ]]; then
  # The archive holds the CONTENTS of the uploads folder ("./..."): unpack
  # into that folder only, never "/" (its "." entry would re-own the root).
  age --decrypt -i "$key" "$files" | tar -C /var/lib/acisi/uploads --no-same-owner --no-overwrite-dir -xf -
  chown -R acisi:acisi /var/lib/acisi; chmod 700 /var/lib/acisi/uploads
fi
nfiles=$(find /var/lib/acisi/uploads -type f | wc -l)
[[ $(stat -c %U:%a /) == root:755 ]] || { chown root:root /; chmod 755 /; echo " Root folder permissions repaired." >&2; }
T4=$(now); echo " RESULT: $nfiles files restored in $(mins $((T4 - T3)))"

echo "=== 5. Install and build ACISI ($(stamp))"
rm -rf /opt/acisi/app; install -d -o acisi -g acisi /opt/acisi/app
tar -C /opt/acisi/app -xzf "$SRC/acisi-app.tar.gz"; chown -R acisi:acisi /opt/acisi/app
runuser -u acisi -- bash -c 'cd /opt/acisi/app && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null'
cp "$work/etc/systemd/system/acisi.service" /etc/systemd/system/acisi.service
systemctl daemon-reload
T5=$(now); echo " RESULT: built in $(mins $((T5 - T4)))"

echo "=== 6. Start ACISI and wait for the health check ($(stamp))"
systemctl start acisi
up=no
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$TEST_PORT/healthz" >/dev/null 2>&1; then up=yes; break; fi
  sleep 2
done
T6=$(now)
[[ $up == yes ]] && echo " RESULT: PASS, answering at $(stamp)" || { echo " RESULT: FAIL, no answer after 3 minutes"; journalctl -u acisi -n 30 --no-pager; }

echo "=== 7. Data checks ($(stamp))"
count_sql="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
restored=$(pg psql -d "$dbname" -Atc "$count_sql")
if [[ -f $SRC/live-counts.txt ]]; then
  tables=$(wc -l <"$SRC/live-counts.txt"); same=$(LC_ALL=C comm -12 <(LC_ALL=C sort "$SRC/live-counts.txt") <(LC_ALL=C sort <<<"$restored") | wc -l)
  echo " Row counts: $same of $tables tables match the live database at backup time"
  [[ $same -eq $tables ]] && counts=PASS || counts=FAIL
else counts="NOT CHECKED (no live counts sent)"; fi
audit=$(runuser -u acisi -- bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s verify-audit-log' 2>&1 | tail -n 3)
echo " Audit log check: $audit"

echo
echo "================ SUMMARY ================"
echo "Software install:   $(mins $((T1 - T0)))"
echo "Database restore:   $(mins $((T3 - TK)))"
echo "Files restore:      $(mins $((T4 - T3))) ($nfiles files)"
echo "App install+build:  $(mins $((T5 - T4)))"
echo "App start:          $(mins $((T6 - T5)))"
echo "RTO measured (fresh server to working ACISI, not counting time waiting for the key): $(mins $(( (T6 - T0) - (TK - T1) )))"
echo "Health check: $up; row counts: $counts"
echo "Not part of this test (would take acisi.co.ke away from the live server):"
echo "  DNS switch in Cloudflare (~5 min) and HTTPS certificate (~10 min): add to the measured RTO."
echo "Report saved: $REPORT"

echo
echo "=== 8. Removing the decrypted test copy ($(stamp))"
systemctl stop acisi; systemctl disable acisi >/dev/null 2>&1 || true
rm -f /etc/systemd/system/acisi.service; systemctl daemon-reload
pg dropdb --if-exists "$dbname"
REDISCLI_AUTH=$rpass redis-cli FLUSHALL >/dev/null
rm -rf /var/lib/acisi/uploads/* /etc/acisi/acisi.env
iptables -D INPUT -p tcp --dport $TEST_PORT ! -i lo -j DROP 2>/dev/null || true
echo " RESULT: test database, patient files and settings deleted; only the encrypted backups remain in $SRC"
