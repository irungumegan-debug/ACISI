#!/usr/bin/env bash
# NOT ENABLED. Template for copying each night's encrypted backup off this
# server. acisi-backup runs /etc/acisi/backup-offsite.sh (if it exists and
# is executable) with the new backup files as arguments.
#
# The destination MUST be in Kenya: patient data may not be stored outside
# Kenya, even encrypted. Planned: HostAfrica's backup add-on. If that add-on
# snapshots the whole server, /var/backups/acisi is already included and
# this hook isn't needed; if it gives you an SSH/SFTP target instead, fill
# in DEST and the key below.
#
# To enable later:
#   sudo install -m 700 /opt/acisi/app/deploy/backup/offsite-hook.example.sh /etc/acisi/backup-offsite.sh
#   sudo nano /etc/acisi/backup-offsite.sh      # set DEST and SSH_KEY
#   sudo systemctl start acisi-backup && sudo journalctl -u acisi-backup -n 20
set -euo pipefail

DEST="backup-user@backup-host.example:acisi/" # a Kenyan destination only
SSH_KEY=/root/.ssh/acisi_offsite

for f in "$@"; do
  rsync -a --chmod=F600 -e "ssh -i $SSH_KEY -o BatchMode=yes" "$f" "$DEST"
done
