# Exposes the local APOS processing API at https://api.nxtgensec.org through a
# Cloudflare Tunnel. The tunnel only works while this machine is on and
# scripts\serve-api.ps1 is running in another window.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\tunnel-apos-api.ps1
#
# First run walks you through `cloudflared login` (opens a browser).

$ErrorActionPreference = "Stop"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$tunnelName = "apos-api"
$hostname = "api.nxtgensec.org"
$origin = "http://127.0.0.1:8000"

if (-not (Test-Path $cloudflared)) {
    Write-Host "cloudflared not found at $cloudflared" -ForegroundColor Red
    exit 1
}

$cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
if (-not (Test-Path $cert)) {
    Write-Host "=== Step 1: authorise cloudflared (opens a browser) ===" -ForegroundColor Cyan
    & $cloudflared tunnel login
    if (-not (Test-Path $cert)) {
        Write-Host "Login did not complete - no cert.pem written." -ForegroundColor Red
        exit 1
    }
}

Write-Host "=== Step 2: create the tunnel (safe to re-run) ===" -ForegroundColor Cyan
$existing = & $cloudflared tunnel list --output json 2>$null | ConvertFrom-Json
if (-not ($existing | Where-Object { $_.name -eq $tunnelName })) {
    & $cloudflared tunnel create $tunnelName
} else {
    Write-Host "Tunnel '$tunnelName' already exists." -ForegroundColor DarkGray
}

Write-Host "=== Step 3: point $hostname at the tunnel ===" -ForegroundColor Cyan
& $cloudflared tunnel route dns $tunnelName $hostname

Write-Host "=== Step 4: running the tunnel (Ctrl+C to stop) ===" -ForegroundColor Cyan
Write-Host "Make sure scripts\serve-api.ps1 is running in another window." -ForegroundColor Yellow
& $cloudflared tunnel run --url $origin $tunnelName
