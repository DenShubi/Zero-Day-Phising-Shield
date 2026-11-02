# Panduan Uji Bot WhatsApp (OpenWA) — VisiKartika Shield

Panduan ini untuk menguji alur **Prajurit → WhatsApp → OpenWA → Backend → balasan + gambar bukti**
memakai nomor bot sungguhan. Semua perintah ditulis untuk **PowerShell (Windows)** dari folder root project.

---

## 0. Sebelum mulai — wajib sekali saja

1. **Ganti (rotate) API key OpenWA lama.** Key `owa_k1_5b5c…` pernah tertulis di `app/webhook_openwa.py`
   dan ikut ter-push ke GitHub (commit `565d58e`). Anggap sudah bocor:
   - Buka dashboard OpenWA → **API Keys** → buat key baru (role **Operator**) → **hapus/revoke** key lama.
2. **Cabut token Fonnte lama.** Token Fonnte pernah tertulis di `app/webhook_wa.py` pada riwayat commit.
   Fonnte sudah tidak dipakai → hapus device/regenerate token di dashboard Fonnte, lalu kosongkan
   `FONNTE_TOKEN` di `.env`.
3. **Isi `.env`** (file ini tidak bisa diedit otomatis — edit manual):
   ```env
   OPENWA_API_URL=http://localhost:2785
   OPENWA_API_KEY=owa_k1_<KEY_BARU_DARI_DASHBOARD>
   OPENWA_SESSION_ID=<id-sesi-openwa>
   OPENWA_WEBHOOK_SECRET=<string-acak-min-16-karakter>
   FONNTE_TOKEN=
   ```
   Buat secret acak: `python -c "import secrets; print(secrets.token_hex(24))"`
4. **Hapus file berisi nomor HP dari git** (file tetap ada di disk, hanya berhenti dilacak):
   ```powershell
   git rm --cached storage/last_wa_payload.json
   git add .gitignore
   git commit -m "chore(security): stop tracking WA debug payload, move secrets to env"
   ```

---

## 1. Jalankan OpenWA gateway

```powershell
cd openwa-gateway
npm run start:prod          # dist/ sudah ter-build; pakai `npm start` bila ingin build ulang
```

- Buka `http://localhost:2785` → login dengan `API_MASTER_KEY` dari `openwa-gateway/.env`.
- Pastikan sesi berstatus **ready/connected**. Jika belum: buka sesi → **Start** → scan QR dengan
  WhatsApp di HP **bot** (*Perangkat Tertaut → Tautkan Perangkat*).
- Catat **Session ID** → isi ke `OPENWA_SESSION_ID`.

## 2. Daftarkan webhook ke backend (dengan secret)

Cek dulu webhook yang sudah ada (hindari duplikat — tiap webhook = satu kali kirim):

```powershell
$H = @{ "X-API-Key" = "<OPENWA_API_KEY>" }
$SID = "<OPENWA_SESSION_ID>"
Invoke-RestMethod "http://localhost:2785/api/sessions/$SID/webhooks" -Headers $H
```

Hapus webhook lama yang menuju `/webhook/openwa` tanpa secret
(`Invoke-RestMethod -Method Delete "http://localhost:2785/api/sessions/$SID/webhooks/<id>" -Headers $H`),
lalu buat yang baru:

```powershell
$body = @{
  url        = "http://localhost:8000/webhook/openwa"
  events     = @("message.received")
  secret     = "<OPENWA_WEBHOOK_SECRET yang sama dengan .env>"
  retryCount = 2
} | ConvertTo-Json
Invoke-RestMethod -Method Post "http://localhost:2785/api/sessions/$SID/webhooks" `
  -Headers $H -ContentType "application/json" -Body $body
```

> `openwa-gateway/.env` juga punya `DEFAULT_WEBHOOK_URL`. Jika webhook itu tetap aktif tanpa secret,
> backend akan menolaknya dengan 401 saat `OPENWA_WEBHOOK_SECRET` diisi — itu normal; pastikan
> webhook yang dipakai adalah yang bersecret di atas.

## 3. Jalankan backend

```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000
```

Cek konfigurasi: buka `http://localhost:8000/webhook/openwa` → harus terlihat
`"api_key_configured": true`, `"default_session_configured": true`, `"signature_verification": true`.

## 4. Skenario uji chat

Kirim dari **HP lain** (bukan HP bot) ke **nomor bot** (nomor yang di-scan di sesi OpenWA).
Chat pribadi saja — pesan grup sengaja diabaikan (`OPENWA_ALLOW_GROUPS=false`).

| # | Kirim ke bot | Balasan yang diharapkan |
|---|---|---|
| 1 | `halo` | Menu bantuan *VISIKARTIKA SHIELD* |
| 2 | `portal` | Daftar domain resmi `.mil.id` / `.go.id` |
| 3 | `status` | Status sandbox, CV engine, koneksi Supabase |
| 4 | `darurat` | Protokol darurat kebocoran kredensial |
| 5 | `cek ini http://localhost:8000/mock-targets/rekrutmen_bintara_phish.html` | `⏳ Tautan diterima…` → laporan **CRITICAL_PHISHING** (skor ±99) → **gambar bukti** ber-kotak merah/oranye |
| 6 | `http://localhost:8000/mock-targets/sso_sisfopers_phish.html` | CRITICAL_PHISHING + gambar bukti |
| 7 | `http://localhost:8000/mock-targets/kemhan_auth_phish.html` | CRITICAL_PHISHING (aturan *Identity-Domain Mismatch*) |
| 8 | `https://tniad.mil.id` | ✅ AMAN — portal resmi (butuh internet) |
| 9 | `https://tniad-mil.id/login` | Domain tiruan; bila situs tidak ada → pesan *gagal mengakses target* |
| 10 | `http://localhost:2785/api/sessions` | ⛔ **TAUTAN DITOLAK** (proteksi SSRF) — tanpa scan |
| 11 | **Foto** poster `mock_targets/assets/poster_quishing_bintara.png` (kirim file ke HP dulu, lalu kirim sebagai *foto*) | `⏳ Gambar diterima…` → CRITICAL_PHISHING, isi QR `rekrutmen-bintara-tniad.com/…` → gambar bukti (QR ungu, logo merah) |
| 12 | Screenshot halaman mock (no. 5) sebagai foto | SUSPICIOUS/CRITICAL karena kemiripan visual + logo |
| 13 | Voice note / dokumen PDF | ⚠️ *Lampiran tidak terbaca* |
| 14 | Kirim pesan yang sama 2× cepat | Diproses wajar; *retry* dari OpenWA tidak menghasilkan balasan ganda |

> Tautan `localhost` pada no. 5–7 aman dipakai karena **sandbox berjalan di laptop server**, bukan di HP.
> Untuk juri/publik nanti, ganti dengan URL publik backend (`PUBLIC_BACKEND_URL`).

Target waktu: perintah teks < 1 detik, scan URL ±3–5 detik, scan gambar ±1–2 detik.

## 5. Troubleshooting

| Gejala | Cek |
|---|---|
| Tidak ada balasan sama sekali, log uvicorn kosong | Webhook belum terdaftar / sesi tidak *ready*. Cek `GET /api/webhooks/delivery-failures` di OpenWA. |
| Log uvicorn: `401` pada `/webhook/openwa` | Secret di webhook OpenWA ≠ `OPENWA_WEBHOOK_SECRET`, atau request lewat tunnel tanpa secret. |
| Log: `[OpenWA send-text ...] HTTP 401/403` | `OPENWA_API_KEY` salah / masih placeholder / role bukan Operator. |
| Log: `HTTP 404` saat kirim | `OPENWA_SESSION_ID` salah atau sesi berhenti. |
| Laporan teks terkirim, gambar tidak | Lihat log `send-image`; pastikan `OPENWA_SEND_EVIDENCE=true`. |
| Balasan `TAUTAN DITOLAK` untuk situs publik | Domain resolve ke IP privat (mis. DNS kantor/VPN). |
| Foto tidak terbaca | Kirim sebagai *foto* (bukan *dokumen*); gambar > ~768 KB diunduh via API — cek API key. |

Uji tanpa WhatsApp (tidak mengirim pesan apa pun):
`POST http://localhost:8000/webhook/openwa?sync=true&dry_run=true` (lihat folder 4 di
`postman/VisiKartika_Phase2.postman_collection.json`).

---

## 6. Catatan deploy publik (Phase 5)

- Jika backend dibuka ke internet (ngrok/VPS/Railway), **wajib** isi `OPENWA_WEBHOOK_SECRET`.
  Tanpa secret, backend hanya menerima request dari localhost (request lewat tunnel ditolak).
- Jangan buka port OpenWA `2785` ke internet; biarkan hanya diakses backend secara lokal/privat.
- Isi `CORS_ORIGINS` dengan domain dashboard Vercel, dan `ADMIN_API_KEY` untuk endpoint admin.
