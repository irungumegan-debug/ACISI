#!/usr/bin/env bash
# Practice restore: decrypts a backup into a throwaway database, prints its
# row counts next to the live database's, then deletes the throwaway copy.
# Proves the backups can actually be read with the private key. Never
# touches the live `acisi` database.
#
# Usage: sudo acisi-restore-test [backup file]   (default: the newest one)
# Installed to /usr/local/sbin/acisi-restore-test.
set -euo pipefail
umask 077

BACKUP_DIR=/var/backups/acisi
TEST_DB=acisi_restore_test

file=${1:-}
if [[ -z $file && -d $BACKUP_DIR ]]; then
  file=$(find "$BACKUP_DIR" -maxdepth 1 -name 'acisi-db-*.dump.age' | sort | tail -n 1)
fi
if [[ -z $file || ! -f $file ]]; then
  echo "No backup found in $BACKUP_DIR yet. Make one first: sudo systemctl start acisi-backup" >&2
  exit 1
fi

# The private key only ever lives in memory-backed /run, and is removed on exit.
key=$(mktemp -p /run acisi-backup-key.XXXXXX)
pg() { runuser -u postgres -- "$@"; }
cleanup() {
  rm -f "$key"
  pg dropdb --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Testing: $(basename "$file")"
read -rsp "Paste the backup private key (the AGE-SECRET-KEY-1... line), then press Enter: " secret
echo
secret=$(tr -d '[:space:]' <<<"$secret") # stray spaces/line endings from copy-paste
if [[ $secret == age1* ]]; then
  echo "That's the PUBLIC key (age1...). Paste the PRIVATE key: the line starting AGE-SECRET-KEY-1." >&2
  exit 1
elif [[ $secret != AGE-SECRET-KEY-1* ]]; then
  echo "That isn't a backup private key: it should be one line starting AGE-SECRET-KEY-1 (${#secret} characters were pasted)." >&2
  exit 1
fi
printf '%s\n' "$secret" >"$key"
unset secret

# Check the key belongs to these backups before restoring anything.
if ! public=$(age-keygen -y "$key" 2>/dev/null); then
  echo "That key is damaged (a character missing or changed). Copy the whole AGE-SECRET-KEY-1... line again." >&2
  exit 1
fi
if [[ -f /etc/acisi/backup-recipients.txt ]] && ! grep -qxF "$public" /etc/acisi/backup-recipients.txt; then
  echo "That key is valid but doesn't match this server's backups. Its public key is: $public" >&2
  echo "The server encrypts backups to: $(grep -v '^#' /etc/acisi/backup-recipients.txt | head -n 1)" >&2
  exit 1
fi

pg dropdb --if-exists "$TEST_DB"
pg createdb "$TEST_DB"
age --decrypt -i "$key" "$file" | pg pg_restore --no-owner --no-privileges --exit-on-error -d "$TEST_DB"

count_sql="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"

backup_counts=$(pg psql -d "$TEST_DB" -Atc "$count_sql")
live_counts=$(pg psql -d acisi -Atc "$count_sql")

echo
echo "Rows per table (backup | live):"
LC_ALL=C join -a1 -a2 -e '-' -o '0,1.2,2.2' <(LC_ALL=C sort <<<"$backup_counts") <(LC_ALL=C sort <<<"$live_counts") |
  awk '{ printf "  %-26s %6s | %s\n", $1, $2, $3 }'
echo
if [[ $backup_counts == "$live_counts" ]]; then
  echo "RESTORE TEST OK: the backup decrypts, restores, and matches the live database."
else
  echo "RESTORE TEST OK: the backup decrypts and restores. Counts differ from live only"
  echo "if something changed since the backup was taken (check the rows above)."
fi
