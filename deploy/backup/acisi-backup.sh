#!/usr/bin/env bash
# Nightly encrypted backup of the ACISI database, the uploaded patient
# files, and the server's ACISI config (settings file, Nginx site, systemd unit). Run as root by
# acisi-backup.timer; installed to /usr/local/sbin/acisi-backup.
#
# Backups are encrypted with `age` to the public key(s) in
# /etc/acisi/backup-recipients.txt. The matching private key is NOT kept on
# this server, so someone who gets into the server still can't read them.
# Plain (unencrypted) data never touches the disk: pg_dump streams straight
# into age.
set -euo pipefail
umask 077

BACKUP_DIR=/var/backups/acisi
RECIPIENTS=/etc/acisi/backup-recipients.txt
OFFSITE_HOOK=/etc/acisi/backup-offsite.sh
KEEP_DAYS=14
# Uploaded files never change once stored, so only the newest few full
# copies are kept (each one is the size of the whole uploads folder).
KEEP_FILE_COPIES=3
UPLOADS_DIR=/var/lib/acisi/uploads
DB=acisi
MIN_FREE_KB=$((1024 * 1024)) # refuse to run with less than 1 GB free

if [[ ! -s $RECIPIENTS ]]; then
  echo "No backup public key in $RECIPIENTS; nothing backed up." >&2
  exit 1
fi

install -d -m 700 "$BACKUP_DIR"
trap 'rm -f "$BACKUP_DIR"/*.part' EXIT

free_kb=$(df --output=avail -k "$BACKUP_DIR" | tail -n 1 | tr -d ' ')
uploads_kb=0
if [[ -d $UPLOADS_DIR ]]; then
  uploads_kb=$(du -sk "$UPLOADS_DIR" | cut -f1)
fi
if ((free_kb < MIN_FREE_KB + uploads_kb)); then
  echo "Only ${free_kb} KB free on $BACKUP_DIR; nothing backed up." >&2
  exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S)
db_file="$BACKUP_DIR/acisi-db-$stamp.dump.age"
cfg_file="$BACKUP_DIR/acisi-config-$stamp.tar.age"
files_file="$BACKUP_DIR/acisi-files-$stamp.tar.age"

# Database: custom format, restorable with pg_restore.
runuser -u postgres -- pg_dump --format=custom "$DB" | age --encrypt -R "$RECIPIENTS" >"$db_file.part"
mv "$db_file.part" "$db_file"

# Config needed to rebuild the server (contains secrets, hence encrypted too).
tar -C / -cf - etc/acisi/acisi.env etc/nginx/sites-available/acisi etc/systemd/system/acisi.service |
  age --encrypt -R "$RECIPIENTS" >"$cfg_file.part"
mv "$cfg_file.part" "$cfg_file"

written=("$db_file" "$cfg_file")

# Uploaded patient files (X-rays, reports, photos of paper records).
# Skips the .incoming folder of half-finished uploads.
if [[ -d $UPLOADS_DIR ]]; then
  tar -C "$UPLOADS_DIR" --exclude=./.incoming -cf - . | age --encrypt -R "$RECIPIENTS" >"$files_file.part"
  mv "$files_file.part" "$files_file"
  written+=("$files_file")
fi

for f in "${written[@]}"; do
  echo "Backup written: $(basename "$f") ($(du -h "$f" | cut -f1))"
done

# Keep KEEP_DAYS days. Only reached when tonight's backup succeeded, so a
# run of failures never deletes the last good copies.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'acisi-db-*.dump.age' -o -name 'acisi-config-*.tar.age' \) \
  -mtime +$((KEEP_DAYS - 1)) -print -delete
# Newest KEEP_FILE_COPIES file archives only (names sort by date).
ls -1 "$BACKUP_DIR"/acisi-files-*.tar.age 2>/dev/null | sort | head -n -"$KEEP_FILE_COPIES" | xargs -r rm -v --

# Off-server copy (disabled until /etc/acisi/backup-offsite.sh exists; see
# deploy/backup/offsite-hook.example.sh). The destination must be in Kenya.
if [[ -x $OFFSITE_HOOK ]]; then
  "$OFFSITE_HOOK" "${written[@]}"
  echo "Off-server copy done."
fi
