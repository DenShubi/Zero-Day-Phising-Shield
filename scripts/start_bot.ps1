# VisiKartika Shield - start everything (OpenWA gateway + FastAPI backend), then health-check.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File scripts\start_bot.ps1
# Use -Update to also refresh dependencies after a `git pull`.
param([switch]$Update)

$root = Split-Path -Parent $PSScriptRoot
$gw   = Join-Path $root "openwa-gateway"
$py   = Join-Path $root ".venv\Scripts\python.exe"
$uv   = Join-Path $root ".venv\Scripts\uvicorn.exe"

if (-not (Test-Path (Join-Path $root ".env"))) { Write-Host "[X] .env tidak ada. Salin .env.example menjadi .env lalu isi." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $py))  { Write-Host "[X] .venv belum dibuat: python -m venv .venv" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $gw))  { Write-Host "[X] Folder openwa-gateway tidak ada. Klon dari https://github.com/rmyndharis/OpenWA" -ForegroundColor Red; exit 1 }

if ($Update) {
    Write-Host "[..] Update dependensi Python..." -ForegroundColor Cyan
    & $py -m pip install -r (Join-Path $root "requirements.txt") pytest
    Write-Host "[..] Update dependensi OpenWA (npm install + build)..." -ForegroundColor Cyan
    Push-Location $gw; npm install; npm run build:all; Pop-Location
}

# stale Windows env var would override .env (caused 'Invalid API key' before)
if ($env:OPENWA_API_KEY) { Write-Host "[!] Variabel Windows OPENWA_API_KEY ada dan MENIMPA .env - dihapus untuk sesi ini." -ForegroundColor Yellow; Remove-Item Env:OPENWA_API_KEY }

Write-Host "[..] Menyalakan OpenWA gateway (jendela baru)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$gw'; npm run start:prod"

Write-Host "[..] Menyalakan backend uvicorn (jendela baru)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root'; & '$uv' app.main:app --host 127.0.0.1 --port 8000"

Write-Host "[..] Menunggu layanan siap (maks 60 detik)..."
$ok = @{ gw = $false; be = $false }
for ($i = 0; $i -lt 30 -and -not ($ok.gw -and $ok.be); $i++) {
    Start-Sleep -Seconds 2
    if (-not $ok.gw) { try { Invoke-WebRequest "http://localhost:2785/api/health/ready" -UseBasicParsing -TimeoutSec 3 | Out-Null; $ok.gw = $true } catch {} }
    if (-not $ok.be) { try { $h = Invoke-RestMethod "http://localhost:8000/webhook/openwa" -TimeoutSec 3; $ok.be = $true } catch {} }
}
if ($ok.gw) { Write-Host "[OK] OpenWA gateway siap  (http://localhost:2785)" -ForegroundColor Green } else { Write-Host "[!] OpenWA belum siap - lihat jendelanya" -ForegroundColor Yellow }
if ($ok.be) {
    Write-Host ("[OK] Backend siap         api_key={0} session={1} signature={2}" -f $h.api_key_configured, $h.default_session_configured, $h.signature_verification) -ForegroundColor Green
} else { Write-Host "[!] Backend belum siap - lihat jendelanya" -ForegroundColor Yellow }
Write-Host ""
Write-Host "Tes: kirim 'halo' dari HP LAIN ke nomor bot. Matikan: tutup kedua jendela (atau Ctrl+C di masing-masing)."
