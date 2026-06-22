<#
.SYNOPSIS
  Cross-platform env check for the Bostead Node.js quickstart (PowerShell).

.DESCRIPTION
  Verifies that every required environment variable is present and not still
  set to an example placeholder from .env.example. Never prints values.

  Works on Windows PowerShell 5.1+ and PowerShell 7+ (macOS / Linux).

.PARAMETER EnvFile
  Optional path to a .env file to load before checking. When omitted, the
  current process environment is checked as-is.

.EXAMPLE
  # Check the current shell environment
  ./scripts/check-env.ps1

.EXAMPLE
  # Load .env first, then check
  ./scripts/check-env.ps1 -EnvFile .env

.NOTES
  Exits 0 on success, 1 on failure. Mirrors scripts/check-env.sh.
#>
[CmdletBinding()]
param(
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

$Required = @(
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_PROJECT_ID',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LOVABLE_API_KEY'
)

$Optional = @('NODE_ENV', 'PORT')

# Optionally load a .env file into the current process env.
if ($EnvFile) {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Error "Env file not found: $EnvFile"
    exit 1
  }
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name  = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Test-Placeholder([string]$value) {
  return $value.StartsWith('your-') -or $value -eq 'https://your-project.supabase.co'
}

$missing      = New-Object System.Collections.Generic.List[string]
$placeholder  = New-Object System.Collections.Generic.List[string]

Write-Host 'Checking required environment variables...'
foreach ($var in $Required) {
  $val = [Environment]::GetEnvironmentVariable($var, 'Process')
  if ([string]::IsNullOrEmpty($val)) {
    Write-Host ("  [MISSING]     {0}" -f $var)
    $missing.Add($var) | Out-Null
  } elseif (Test-Placeholder $val) {
    Write-Host ("  [PLACEHOLDER] {0} (still set to .env.example default)" -f $var)
    $placeholder.Add($var) | Out-Null
  } else {
    Write-Host ("  [OK]          {0}" -f $var)
  }
}

Write-Host ''
Write-Host 'Optional variables:'
foreach ($var in $Optional) {
  $val = [Environment]::GetEnvironmentVariable($var, 'Process')
  if ([string]::IsNullOrEmpty($val)) {
    Write-Host ("  [unset]       {0}" -f $var)
  } else {
    Write-Host ("  [OK]          {0}" -f $var)
  }
}

if ($missing.Count -gt 0 -or $placeholder.Count -gt 0) {
  Write-Host ''
  Write-Host ("FAIL: {0} missing, {1} still using example placeholders." -f $missing.Count, $placeholder.Count)
  Write-Host 'Fix: copy .env.example to .env, edit it, then run:'
  Write-Host '  ./scripts/check-env.ps1 -EnvFile .env'
  exit 1
}

Write-Host ''
Write-Host 'OK: all required environment variables are present.'
exit 0
