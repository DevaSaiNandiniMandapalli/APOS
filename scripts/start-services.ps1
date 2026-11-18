# Starts the APOS processing API and a Cloudflare quick tunnel as detached
# processes, so they survive the terminal that launched them.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\start-services.ps1
#
# Prints the public URL. If the URL changes, rebuild and redeploy with:
#   powershell -ExecutionPolicy Bypass -File scripts\build-with-server.ps1 -ApiUrl <url>
#   npx wrangler deploy

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$log = Join-Path $env:TEMP "apos-tunnel.log"

# 1. Stop anything already listening on 8000 or running cloudflared.
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 2. Start the API detached.
$env:CORS_ORIGINS = "https://apos.nxtgensec.org,http://localhost:3000,http://127.0.0.1:3000"
Start-Process -FilePath "python" `
    -ArgumentList "-m","uvicorn","apos_api.main:app","--app-dir","backend","--host","127.0.0.1","--port","8000" `
    -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 6

if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "The API did not start. Check that Python and the backend dependencies are installed." -ForegroundColor Red
    exit 1
}
Write-Host "API listening on http://127.0.0.1:8000" -ForegroundColor Green

# 3. Start the tunnel detached (HTTP/2, because QUIC is often blocked).
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel","--url","http://127.0.0.1:8000","--protocol","http2","--no-autoupdate" `
    -WindowStyle Hidden -RedirectStandardError $log -RedirectStandardOutput "$log.out"

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($match) {
        $url = [regex]::Match($match.Line, "https://[a-z0-9-]+\.trycloudflare\.com").Value
        Write-Host ""
        Write-Host "Public API: $url" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "If the live site does not pick it up, rebuild and redeploy:" -ForegroundColor Yellow
        Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\build-with-server.ps1 -ApiUrl $url"
        Write-Host "  npx wrangler deploy"
        exit 0
    }
}

Write-Host "The tunnel did not report a URL. See $log" -ForegroundColor Red
exit 1
