<#
.SYNOPSIS
  Cross-platform env check for the Bostead Node.js quickstart (PowerShell).

.DESCRIPTION
  Verifies that every required environment variable is present and not still
  set to an example placeholder from .env.example. Never prints values.

  Includes a robust .env parser that supports:
    - blank lines and full-line comments (# ...)
    - optional leading `export `
    - single-quoted values (literal — no expansion, no escapes)
    - double-quoted values (with \n \r \t \\ \" escapes)
    - unquoted values (inline `#` starts a comment when preceded by whitespace)
    - CRLF line endings

  Works on Windows PowerShell 5.1+ and PowerShell 7+ (macOS / Linux).

.PARAMETER EnvFile
  Optional path to a .env file to load before checking. When omitted, the
  current process environment is checked as-is.

.EXAMPLE
  ./scripts/check-env.ps1
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
  'SUPABASE_SERVICE_ROLE_KEY'
)

$Optional = @('NODE_ENV', 'PORT')

function ConvertFrom-DoubleQuoted([string]$body) {
  # $body is the contents between the surrounding double quotes (already stripped).
  $sb = New-Object System.Text.StringBuilder
  $i = 0
  $len = $body.Length
  while ($i -lt $len) {
    $c = $body[$i]
    if ($c -eq '\' -and ($i + 1) -lt $len) {
      $next = $body[$i + 1]
      switch ($next) {
        'n'  { [void]$sb.Append("`n") }
        'r'  { [void]$sb.Append("`r") }
        't'  { [void]$sb.Append("`t") }
        '\'  { [void]$sb.Append('\') }
        '"'  { [void]$sb.Append('"') }
        default { [void]$sb.Append($next) }
      }
      $i += 2
      continue
    }
    [void]$sb.Append($c)
    $i++
  }
  return $sb.ToString()
}

function Parse-EnvValue([string]$raw) {
  # Strip trailing CR
  if ($raw.EndsWith("`r")) { $raw = $raw.Substring(0, $raw.Length - 1) }
  $raw = $raw.TrimStart()
  if ([string]::IsNullOrEmpty($raw)) { return '' }
  $first = $raw[0]
  if ($first -eq "'") {
    $end = $raw.IndexOf("'", 1)
    if ($end -lt 0) { return $raw.Substring(1) }
    return $raw.Substring(1, $end - 1)
  }
  if ($first -eq '"') {
    # Find the matching unescaped closing quote
    $i = 1
    $len = $raw.Length
    while ($i -lt $len) {
      $c = $raw[$i]
      if ($c -eq '\' -and ($i + 1) -lt $len) { $i += 2; continue }
      if ($c -eq '"') { break }
      $i++
    }
    $body = if ($i -le $len) { $raw.Substring(1, $i - 1) } else { $raw.Substring(1) }
    return (ConvertFrom-DoubleQuoted $body)
  }
  # Unquoted: strip inline ` #...` comment, then trim trailing whitespace.
  $stripped = [System.Text.RegularExpressions.Regex]::Replace($raw, '\s+#.*$', '')
  return $stripped.TrimEnd()
}

function Load-EnvFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Error "Env file not found: $path"
    exit 2
  }
  $lineno = 0
  foreach ($line in (Get-Content -LiteralPath $path)) {
    $lineno++
    $trimmed = $line.TrimStart()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    if ($trimmed.StartsWith('#')) { continue }
    if ($trimmed -match '^export[\s\t]+') {
      $trimmed = $trimmed -replace '^export[\s\t]+', ''
    }
    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) {
      Write-Warning "Skipping malformed line $lineno in $path"
      continue
    }
    $key = $trimmed.Substring(0, $eq).TrimEnd()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      Write-Warning "Skipping invalid key on line ${lineno}: $key"
      continue
    }
    $rhs = $trimmed.Substring($eq + 1)
    $val = Parse-EnvValue $rhs
    [Environment]::SetEnvironmentVariable($key, $val, 'Process')
  }
}

if ($EnvFile) { Load-EnvFile $EnvFile }

function Test-Placeholder([string]$value) {
  return $value.StartsWith('your-') -or $value -eq 'https://your-project.supabase.co'
}

$missing     = New-Object System.Collections.Generic.List[string]
$placeholder = New-Object System.Collections.Generic.List[string]

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
