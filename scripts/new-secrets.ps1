<#
.SYNOPSIS  Creates the random database passwords Docker Compose expects (once per install).
#>
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend/db'
foreach ($f in '.db_password', '.db_app_password') {
  $path = Join-Path $dir $f
  if (Test-Path $path) { "$f exists, keeping it"; continue }
  $bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [IO.File]::WriteAllText($path, [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_'))
  "created backend/db/$f"
}
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend/.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path (Split-Path $PSScriptRoot -Parent) 'backend/.env.example') $envFile; 'created backend/.env from .env.example' }
