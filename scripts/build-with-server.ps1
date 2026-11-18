# Builds the static export with the optional processing server wired in.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\build-with-server.ps1
#
# Change $ApiUrl if you host the FastAPI service somewhere other than the tunnel.

param(
    [string]$ApiUrl = "https://api.nxtgensec.org"
)

$env:NEXT_PUBLIC_APOS_API_URL = $ApiUrl
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "Building with NEXT_PUBLIC_APOS_API_URL=$ApiUrl" -ForegroundColor Cyan
npm run build

Write-Host ""
Write-Host "Allowing the API origin in the Content-Security-Policy" -ForegroundColor Cyan
node scripts/patch-headers.mjs

Write-Host ""
Write-Host "Next: npx wrangler deploy" -ForegroundColor Cyan
