#!/bin/sh
# Daily pg_dump of the `cta` schema (custom format) into /backups.
# A dump is written to a .tmp file and only renamed when pg_dump succeeds, so a
# half-written file is never mistaken for a good backup (the next run overwrites it).
# Dumps older than BACKUP_RETENTION_DAYS (default 14) are expired.
set -u
PGPASSWORD="$(cat /run/secrets/db_password)"
export PGPASSWORD
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

while true; do
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  target="/backups/cta-${stamp}.dump"
  if pg_dump -h db -U cta_admin -d cta -n cta -Fc --no-owner -f /backups/in-progress.tmp; then
    mv /backups/in-progress.tmp "$target"
    echo "backup ok ${target}"
  else
    echo "backup FAILED at ${stamp}"
  fi
  find /backups -maxdepth 1 -name 'cta-*.dump' -mtime "+${RETENTION}" -delete
  sleep "$INTERVAL"
done
