# Starts the APOS processing API with production CORS for apos.nxtgensec.org.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\serve-api.ps1

$env:CORS_ORIGINS = "https://apos.nxtgensec.org,http://localhost:3000,http://127.0.0.1:3000"
$env:APOS_MAX_UPLOAD_MB = "50"
$env:APOS_MAX_FILES = "20"
$env:APOS_RATE_LIMIT_REQUESTS = "120"
$env:APOS_RATE_LIMIT_WINDOW = "60"

Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "APOS processing API on http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "CORS: $env:CORS_ORIGINS" -ForegroundColor DarkGray
python -m uvicorn apos_api.main:app --app-dir backend --host 127.0.0.1 --port 8000
