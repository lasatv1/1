<#
.SYNOPSIS  Restores a backup made by db-backup.ps1 or the db-backup service.
           This REPLACES the current contents of the `cta` schema.
.DESCRIPTION
  1. Takes a safety backup of the current database (backups/pre-restore-*.dump).
  2. Stops the API and worker so nothing writes during the restore.
  3. As the admin role, recreates the `cta` schema owned by the app role `cta_app`.
  4. Loads the backup as `cta_app` in a single transaction (all-or-nothing).
  5. Restarts the services and clears the Redis cache.
.EXAMPLE   ./scripts/db-restore.ps1 -File backups/cta-20261127-020000.dump
.EXAMPLE   ./scripts/db-restore.ps1 -File backups/cta-20261127-020000.dump -Yes   # no prompt (automation)
#>
param(
  [Parameter(Mandatory)][string]$File,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$path = (Resolve-Path $File).Path
$header = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($path)[0..4])
if ($header -ne 'PGDMP') { throw "$File is not a pg_dump custom-format backup" }
if (-not $Yes) {
  $answer = Read-Host "This overwrites the live database with $File. Type 'restore' to continue"
  if ($answer -ne 'restore') { 'Aborted.'; exit 1 }
}
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
  $db = docker compose ps -q db
  if (-not $db) { throw 'The db service is not running (docker compose up -d db)' }

  # 1. Safety net: keep what is there now (skipped if the schema is already gone).
  $hasSchema = docker compose exec -T db psql -U cta_admin -d cta -tAc "select count(*) from pg_namespace where nspname='cta'"
  if ($hasSchema.Trim() -eq '1') {
    $safety = "backups/pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
    docker compose exec -T db sh -c 'pg_dump -U cta_admin -d cta -n cta -Fc --no-owner' > $safety
    if ($LASTEXITCODE -ne 0) { throw 'Safety backup failed; nothing was changed.' }
    "Safety backup: $safety"
  }

  docker cp $path "${db}:/tmp/restore.dump" | Out-Null
  docker compose stop backend worker | Out-Null

  # 2-3. Recreate the schema as admin, owned by the app role (which cannot create schemas itself).
  docker compose exec -T db psql -U cta_admin -d cta -v ON_ERROR_STOP=1 -qc 'DROP SCHEMA IF EXISTS cta CASCADE; CREATE SCHEMA cta AUTHORIZATION cta_app;'
  if ($LASTEXITCODE -ne 0) { throw 'Could not recreate schema' }

  # 4. Restore everything except the schema object itself, as cta_app, atomically.
  docker compose exec -T db sh -c 'pg_restore -l /tmp/restore.dump | grep -v " SCHEMA - cta " > /tmp/restore.list && pg_restore -U cta_admin -d cta --no-owner --role=cta_app --single-transaction --exit-on-error -L /tmp/restore.list /tmp/restore.dump; s=$?; rm -f /tmp/restore.dump /tmp/restore.list; exit $s'
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed ($LASTEXITCODE). Services are stopped; restore the safety backup with this script." }
} finally {
  # 5. Always bring the services back.
  docker compose start backend worker | Out-Null
  Pop-Location
}
Push-Location $root
try { docker compose exec -T backend python -m app.manage cache-clear } finally { Pop-Location }
'Restore complete.'
