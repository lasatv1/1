<#
.SYNOPSIS  On-demand database backup (custom-format pg_dump) into ./backups.
.EXAMPLE   ./scripts/db-backup.ps1
Daily automatic backups are also taken by the `db-backup` compose service.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $dir | Out-Null
$name = "cta-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
Push-Location $root
try {
  docker compose exec -T db sh -c 'pg_dump -U cta_admin -d cta -n cta -Fc --no-owner' > (Join-Path $dir $name)
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$size = (Get-Item (Join-Path $dir $name)).Length / 1MB
"Backup written: backups/$name ({0:N1} MB)" -f $size
