#!/usr/bin/env bash
# Step 1 of the full rebuild test (DR Test Report: "RTO — Overall").
# Run on the MAIN server (HostAfrica). Takes a fresh encrypted backup, the
# app code (no secrets) and the live row counts (numbers only, no patient
# data), and copies them to the standby/backup server in Kenya.
#
# Usage: sudo bash acisi-dr-send.sh USER@HOST PORT
#   e.g. sudo bash acisi-dr-send.sh acisiadmin@102.221.32.220 2222
# Needs root's SSH key authorised on the standby server (runbook "Full
# rebuild test on the Angani server").
set -euo pipefail
umask 077

DEST=${1:?Usage: sudo bash acisi-dr-send.sh USER@HOST PORT}
PORT=${2:?Usage: sudo bash acisi-dr-send.sh USER@HOST PORT}
BACKUP_DIR=/var/backups/acisi
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

echo "=== Fresh backup ($(date '+%d %b %Y %H:%M:%S %Z'))"
systemctl start acisi-backup
newest() { find "$BACKUP_DIR" -maxdepth 1 -name "$1" | sort | tail -n 1; }
db=$(newest 'acisi-db-*.dump.age'); cfg=$(newest 'acisi-config-*.tar.age'); files=$(newest 'acisi-files-*.tar.age')
[[ -n $db && -n $cfg ]] || { echo "No backup found in $BACKUP_DIR" >&2; exit 1; }
echo " $(basename "$db"), $(basename "$cfg")${files:+, $(basename "$files")}"

echo "=== Live row counts (table names and numbers only)"
runuser -u postgres -- psql -d acisi -Atc "SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;" >"$OUT/live-counts.txt"
echo " $(wc -l <"$OUT/live-counts.txt") tables"

echo "=== App code (the commit running now; no settings or secrets)"
git -C /opt/acisi/app archive --format=tar.gz -o "$OUT/acisi-app.tar.gz" HEAD
git -C /opt/acisi/app rev-parse --short HEAD >"$OUT/app-commit.txt"
echo " commit $(cat "$OUT/app-commit.txt")"

echo "=== Copying to $DEST (port $PORT)"
ssh -p "$PORT" -o BatchMode=yes "$DEST" 'mkdir -p ~/acisi-dr && chmod 700 ~/acisi-dr && rm -f ~/acisi-dr/*'
scp -P "$PORT" -o BatchMode=yes "$db" "$cfg" ${files:+"$files"} "$OUT"/* "$DEST:acisi-dr/"
echo "SENT. Now log in to the standby server and run: sudo bash acisi-rebuild-test.sh ~/acisi-dr"
