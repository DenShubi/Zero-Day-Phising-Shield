# VisiKartika Shield - one-shot OpenWA webhook setup + diagnosis (PowerShell 5.1+).
# Reads OPENWA_* from ../.env (never prints keys/secrets), then:
#   1. checks the backend (port 8000) config flags
#   2. removes old webhooks that point to /webhook/openwa (no/other secret)
#   3. registers a fresh webhook with OPENWA_WEBHOOK_SECRET
#   4. fires a test event and shows recent delivery failures
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts\setup_openwa_webhook.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw ".env tidak ditemukan di $root" }

$cfg = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $i = $line.IndexOf("=")
        $cfg[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    }
}

$api    = if ($cfg["OPENWA_API_URL"]) { $cfg["OPENWA_API_URL"].TrimEnd("/") } else { "http://localhost:2785" }
$key    = $cfg["OPENWA_API_KEY"]
$sid    = $cfg["OPENWA_SESSION_ID"]
$secret = $cfg["OPENWA_WEBHOOK_SECRET"]
$hook   = "http://localhost:8000/webhook/openwa"

function Fail($msg) { Write-Host "[X] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "[..] $msg" -ForegroundColor Cyan }

if (-not $key -or $key -like "*<*")  { Fail "OPENWA_API_KEY di .env belum diisi." }
if (-not $sid -or $sid -like "*<*")  { Fail "OPENWA_SESSION_ID di .env belum diisi." }
if (-not $secret -or $secret.Length -lt 16) { Fail "OPENWA_WEBHOOK_SECRET di .env kosong / kurang dari 16 karakter." }

# --- 1. backend check -------------------------------------------------------
Info "Cek backend $hook"
try {
    $h = Invoke-RestMethod "http://localhost:8000/webhook/openwa" -TimeoutSec 8
    Write-Host ("     api_key_configured={0}  default_session_configured={1}  signature_verification={2}" -f `
        $h.api_key_configured, $h.default_session_configured, $h.signature_verification)
    if (-not ($h.api_key_configured -and $h.signature_verification)) {
        Write-Host "[!] Backend belum membaca .env baru. Restart uvicorn (Ctrl+C lalu jalankan lagi)." -ForegroundColor Yellow
    } else { Ok "Backend siap" }
} catch {
    Write-Host "[!] Backend TIDAK menyala di port 8000. Jalankan uvicorn di jendela lain dulu." -ForegroundColor Yellow
}

# --- 2. gateway check + pick a key that may manage webhooks ----------------
function Call($method, $path, $apiKey, $body) {
    $args2 = @{ Method = $method; Uri = "$api$path"; Headers = @{ "X-API-Key" = $apiKey }; TimeoutSec = 20 }
    if ($body) { $args2["ContentType"] = "application/json"; $args2["Body"] = ($body | ConvertTo-Json -Depth 6) }
    return Invoke-RestMethod @args2
}

$adminFile = Join-Path $root "openwa-gateway\data\.api-key"
$useKey = $key
Info "Cek gateway OpenWA $api"
try {
    $null = Call "GET" "/api/sessions/$sid/webhooks" $useKey $null
} catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if (($code -eq 401 -or $code -eq 403) -and (Test-Path $adminFile)) {
        Write-Host "[!] Key Operator tidak boleh mengelola webhook (HTTP $code). Memakai key admin dari data\.api-key (hanya untuk skrip ini)." -ForegroundColor Yellow
        $useKey = (Get-Content $adminFile -Raw).Trim()
    } elseif ($code -eq 404) {
        Fail "Session ID tidak ditemukan (404). Cek OPENWA_SESSION_ID di .env."
    } elseif ($code -eq 0) {
        Fail "Gateway OpenWA tidak bisa dihubungi di $api. Jalankan 'npm run start:prod' di folder openwa-gateway."
    } else {
        Fail "Gateway menolak request (HTTP $code). OPENWA_API_KEY salah?"
    }
}

# --- 3. remove old webhooks pointing at our backend ------------------------
$list = Call "GET" "/api/sessions/$sid/webhooks" $useKey $null
$items = @()
if ($list -is [System.Array]) { $items = $list }
elseif ($list.data) { $items = @($list.data) }
elseif ($list.webhooks) { $items = @($list.webhooks) }
Info ("Webhook terdaftar saat ini: {0}" -f $items.Count)
foreach ($w in $items) {
    Write-Host ("     - id={0} url={1} events={2}" -f $w.id, $w.url, ($w.events -join ","))
    if ($w.url -like "*/webhook/openwa*") {
        Call "DELETE" "/api/sessions/$sid/webhooks/$($w.id)" $useKey $null | Out-Null
        Write-Host "       dihapus (diganti yang bersecret)" -ForegroundColor DarkYellow
    }
}

# --- 4. create the new signed webhook --------------------------------------
$new = Call "POST" "/api/sessions/$sid/webhooks" $useKey @{
    url = $hook; events = @("message.received"); secret = $secret; retryCount = 2
}
$newId = if ($new.id) { $new.id } elseif ($new.data.id) { $new.data.id } else { $null }
if (-not $newId) { Fail "Webhook dibuat tetapi id tidak terbaca. Cek dashboard OpenWA > Webhooks." }
Ok "Webhook baru terdaftar (id=$newId) -> $hook"

# --- 5. test delivery --------------------------------------------------------
Info "Mengirim event percobaan ke backend..."
try { Call "POST" "/api/sessions/$sid/webhooks/$newId/test" $useKey $null | Out-Null } catch {
    Write-Host "[!] Endpoint test gagal: $($_.Exception.Message)" -ForegroundColor Yellow
}
Start-Sleep -Seconds 4
try {
    $fail = Call "GET" "/api/webhooks/delivery-failures" $useKey $null
    $fi = @()
    if ($fail -is [System.Array]) { $fi = $fail } elseif ($fail.data) { $fi = @($fail.data) } elseif ($fail.items) { $fi = @($fail.items) }
    $mine = @($fi | Where-Object { $_.webhookId -eq $newId })
    if ($mine.Count -eq 0) { Ok "Tidak ada kegagalan pengiriman untuk webhook baru." }
    else { Write-Host ("[!] {0} pengiriman gagal untuk webhook baru. Lihat log uvicorn (401 = secret beda, tidak ada log = backend mati)." -f $mine.Count) -ForegroundColor Yellow }
} catch { Info "Daftar delivery-failures tidak bisa dibaca (diabaikan)." }

Write-Host ""
Write-Host "Selesai. Lihat jendela uvicorn: harus ada baris POST /webhook/openwa dari event percobaan." -ForegroundColor Green
Write-Host "Lalu kirim 'halo' dari HP LAIN ke nomor bot."
