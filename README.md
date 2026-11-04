# 🛡️ VisiKartika Shield (`Zero-Day-Phising-Shield`)

**Zero-Day Visual Phishing & Military Portal Impersonation Defense System**  
*Kartika Cyber Hackathon 2026 — Kategori: **Penangkalan** (PUSSIBERAD TNI AD)*

[![Kategori](https://img.shields.io/badge/Kategori-Penangkalan-183923?style=flat-square)](#1-deskripsi-produk--skenario-taktis-tni-ad)
[![Backend](https://img.shields.io/badge/Backend-FastAPI_%7C_Playwright_%7C_OpenCV-009688?style=flat-square)](#5-panduan-menjalankan-phase-1-backend-engine)
[![Vision](https://img.shields.io/badge/Vision-YOLOv8_%7C_ViT_%7C_SSIM_%7C_EasyOCR-c9a227?style=flat-square)](#2-arsitektur--spesifikasi-tech-stack)
[![SOC](https://img.shields.io/badge/SOC_Dashboard-Next.js_%7C_Supabase_Realtime-000000?style=flat-square)](#6-skema-database-supabase-postgresql--realtime)

---

## 1. Deskripsi Produk & Skenario Taktis TNI AD

**VisiKartika Shield** adalah platform pertahanan siber *multi-modal* yang dirancang khusus untuk menangkal serangan *zero-day phishing*, kloning visual portal resmi `.mil.id`, penipuan berbasis QR Code (*Quishing*), serta mendeteksi eksfiltrasi kredensial prajurit ke server *Command & Control* (C2) eksternal.

### Masalah Nyata di Satuan
Penyerang membuat situs tiruan yang secara visual identik dengan portal resmi TNI AD (seperti **Portal Seleksi Bintara/Tamtama Siber**, halaman **Single Sign-On (SSO)** internal, atau sistem **Sisfopers / E-Militer**), lalu menyebarkan tautan maupun poster ber-QR Code melalui pesan berantai WhatsApp atau SMS kepada prajurit dan keluarganya. Pendekatan *blacklist* tradisional gagal mendeteksi situs-situs ini pada jam-jam pertama (*zero-day*) karena domain baru didaftarkan dan struktur HTML/JS-nya diacak (*obfuscated*).

### Solusi Taktis VisiKartika Shield
Sistem bekerja melalui dua kanal terpadu: **WhatsApp Bot Lapor Cepat** (untuk prajurit di lapangan) dan **Dashboard SOC Komando** (untuk operator PUSSIBERAD). Saat tautan atau tangkapan layar dikirimkan:
1. Sistem membuka URL di dalam **Headless Chromium Sandbox** terisolasi (memblokir *drive-by download* `.apk`/`.exe`).
2. Mengekstrak pohon struktur **DOM/HTML**, koordinat *bounding box* elemen `<form>` dan `<input>` sensitif (NRP, NIK, Kata Sandi, PIN, OTP), serta merekam lalu lintas jaringan lintas-domain (*cross-origin exfiltration*).
3. Membandingkan kemiripan visual halaman (**SSIM / ViT Embedding**) dan mendeteksi pencatutan lambang resmi (**Kartika Eka Paksi**, **PUSSIBERAD**, lambang **Kodam/Satuan**) menggunakan **Computer Vision (YOLOv8 / OpenCV)**.
4. Mengirimkan putusan ancaman (*verdict*) beserta bukti visual ber-anotasi *bounding box* merah/oranye ke prajurit dan layar pusat komando secara *real-time* dalam waktu **< 5 detik**.

---

## 2. Arsitektur & Spesifikasi Tech Stack

```mermaid
flowchart LR
    subgraph Edge["1. Kanal Pelaporan (Edge Input)"]
        WA["WhatsApp Bot Lapor Cepat\n(WA Gateway API)"]
        WEB["1-Click Judge Sandbox &\nSOC Web Input"]
    end

    subgraph Engine["2. Backend Engine (FastAPI + Docker Sandbox)"]
        PW["Playwright Headless Chromium\n(1280x720, No-Download Sandbox)"]
        DOM["DOM Telemetry & Heuristics\n(Form Action, NRP/Password, SSL/Domain)"]
        CV["Computer Vision Engine\n(SSIM, YOLOv8/OpenCV Logo, EasyOCR/PyZbar)"]
        FUSION["Multi-Indicator Risk Fusion\n(45% Visual + 30% DOM + 25% Domain)"]
    end

    subgraph Command["3. Penyimpanan & Pusat Komando (SOC)"]
        SB[("Supabase PostgreSQL\n+ Realtime + Storage")]
        SOC["Next.js SOC Dashboard\n(Side-by-Side Forensics & Blocklist Export)"]
    end

    WA --> PW
    WEB --> PW
    PW --> DOM
    PW --> CV
    DOM --> FUSION
    CV --> FUSION
    FUSION --> SB
    SB --> SOC
    FUSION --> WA
```

| Lapisan Sistem | Teknologi yang Digunakan | Fungsi Spesifik dalam Pipeline |
| :--- | :--- | :--- |
| **1. Kanal Pelaporan Prajurit (Edge Input)** | **OpenWA Gateway (Baileys)** — menggantikan Fonnte & **Chrome Extension (Manifest V3)** | Menerima *forward* tautan mencurigakan, poster pengumuman, atau tangkapan layar langsung dari ponsel prajurit tanpa instalasi aplikasi tambahan. |
| **2. Sandbox & Ekstraksi Aman** | **Playwright** (Headless Chromium dalam **Docker Container** non-root `pwuser`) | Mengunjungi URL target di lingkungan terisolasi (`1280x720`, `accept_downloads=False`), menangkap *screenshot*, mengekstrak koordinat DOM, dan melacak *redirect chain* / domain eksternal. |
| **3. Mesin Deteksi Visual (Computer Vision)** | **PyTorch**, **OpenCV**, **YOLOv8 / ViT / CLIP**, **Scikit-Image (SSIM)**, **EasyOCR & PyZbar** | • **Deteksi Logo & Identitas:** Mengenali pencatutan lambang Kartika Eka Paksi & PUSSIBERAD beserta *bounding box*.<br>• **Visual Layout Similarity:** Menghitung kemiripan tata letak terhadap *database* tampilan resmi `.mil.id`.<br>• **OCR & Quishing Scanner:** Membaca teks dan QR code berbahaya pada poster rekrutmen palsu. |
| **4. Analisis DOM & Telemetri Domain** | **DOM Heuristic Extractor**, **URL/Host Telemetry**, **TLS/SSL & Whitelist `.mil.id`** | • **DOM Telemetry:** Mendeteksi `<form action="...">` lintas-origin, input NRP/NIK/Password, *form-less AJAX harvesting*, dan anti-inspeksi (`oncontextmenu`).<br>• **Heuristik Domain:** Mendeteksi *typosquatting* kata kunci militer di luar namespace resmi `.mil.id` / `.go.id`. |
| **5. Backend API & Database** | **FastAPI (Python)** + **Supabase (PostgreSQL, Realtime & Storage)** | Menjalankan orkestrasi sandbox & *inference* Computer Vision serta menyinkronkan log insiden secara *real-time* ke layar pusat komando. |
| **6. Command Center Dashboard (SOC)** | **Next.js (App Router)**, **TailwindCSS**, **Shadcn UI**, **Leaflet / Mapbox** | Antarmuka operator PUSSIBERAD untuk memantau insiden *real-time*, *Side-by-Side Visual Forensics*, *1-Click Judge Sandbox*, dan *Export DNS Sinkhole / Firewall Blocklist*. |

---

## 3. Rumus Skor Risiko Multi-Indikator & Logika Deteksi

VisiKartika Shield menggabungkan tiga matriks utama ke dalam **Total Risk Score (0–100)**:

$$\text{Total Risk Score} = (0.45 \times \text{Visual Similarity Score}) + (0.30 \times \text{DOM Anomaly Score}) + (0.25 \times \text{Domain Telemetry Score})$$

### Aturan Silang *Identity-Domain Mismatch*
Untuk mengatasi kelemahan *full-page similarity* ketika penyerang memodifikasi tata letak halaman, sistem menerapkan aturan silang:
- **Logo / Atribut Resmi TNI AD Terdeteksi** (`Confidence >= 80%` atau pencatutan kata kunci militer)
- **Domain Bukan Whitelist Resmi** (`domain` $\notin$ `{tniad.mil.id, rekrutmen-tni.mil.id, pussiberad.mil.id, kemhan.go.id}`)
- **Terdapat Input Kredensial Sensitif** (`NRP / NIK / Password / PIN / OTP` atau eksfiltrasi `<form>` lintas-domain)

Jika ketiga kondisi di atas terpenuhi secara bersamaan, sistem otomatis menetapkan putusan **`CRITICAL_PHISHING`** (`Total Risk Score >= 70`).

| Rentang Skor | Putusan (*Verdict*) | Tindakan Otomatis Sistem |
| :---: | :---: | :--- |
| **`70.0 – 100.0`** | `CRITICAL_PHISHING` | Peringatan merah di WhatsApp & SOC Dashboard + Rekomendasi blokir otomatis (DNS Sinkhole / Firewall Rule). |
| **`40.0 – 69.9`** | `SUSPICIOUS` | Peringatan kuning (anomali parsial ditemukan) + Antrean peninjauan analis SOC. |
| **`0.0 – 39.9`** | `SAFE` | Domain terverifikasi resmi `.mil.id` / `.go.id` atau tidak ditemukan indikasi penyamaran & pencurian kredensial. |

---

## 4. Struktur Repositori (`backend-engine` & Monorepo)

```text
Zero-Day-Phising-Shield/
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI Server (/api/v1/scan/phase1, /health, Static Mounts)
│   ├── models.py                   # Kontrak Data JSON Pydantic v2 (Phase1ScanResponse, dll.)
│   ├── sandbox/
│   │   ├── __init__.py
│   │   ├── browser.py              # HeadlessSandboxScanner (Playwright 1280x720 + DOM/BBox Extractor)
│   │   └── annotator.py            # OpenCV Bounding Box Visualizer (FORM EXFIL & INPUT Kredensial)
│   ├── vision/                     # (Phase 2 & 4) SSIM Similarity, Logo Detector & EasyOCR/PyZbar
│   └── reference_db/               # Template Screenshot & Logo Resmi (.mil.id)
├── mock_targets/
│   └── rekrutmen_bintara_phish.html # Target Uji Simulasi Portal Seleksi Bintara Siber TNI AD 2026
├── storage/
│   ├── screenshots/                # Tangkapan layar mentah (1280x720 PNG)
│   │   └── test_001.png
│   └── annotated/                  # Tangkapan layar dengan anotasi Bounding Box (1280x720 PNG)
│       └── test_001_dom.png
├── requirements.txt
├── Dockerfile                      # Container terisolasi (mcr.microsoft.com/playwright/python:v1.47.0-noble)
├── .dockerignore
├── test_phase1_e2e.py              # Skrip verifikasi otomatis End-to-End Phase 1
└── README.md
```

---

## 5. Panduan Menjalankan Phase 1 (Backend Engine)

**Phase 1 (Headless Sandbox Capture, DOM Form/Input Telemetry Extraction, OpenCV Bounding Box Annotation, dan FastAPI Endpoint)** telah selesai diimplementasikan dan terverifikasi penuh.

### A. Persiapan Lingkungan Lokal (Windows PowerShell / Linux / macOS)

```powershell
# 1. Buat dan aktifkan virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Instal dependensi Python dan browser Chromium Playwright
pip install --only-binary=:all: -r requirements.txt
playwright install chromium
```

### B. Menjalankan Pengujian Otomatis End-to-End (`test_phase1_e2e.py`)

```powershell
.\.venv\Scripts\python.exe test_phase1_e2e.py
```

Skrip ini akan:
1. Menjalankan server HTTP lokal untuk menyajikan `mock_targets/rekrutmen_bintara_phish.html`.
2. Memindai halaman menggunakan `HeadlessSandboxScanner` (`1280x720`, memblokir unduhan berbahaya).
3. Menghasilkan gambar mentah di `storage/screenshots/test_001.png` dan gambar beranotasi *bounding box* di `storage/annotated/test_001_dom.png`.
4. Memverifikasi bahwa `has_credential_harvesting == True`, `dom_anomaly_score == 100.0`, serta menguji endpoint FastAPI `/health` dan `POST /api/v1/scan/phase1`.

### C. Menjalankan Server FastAPI & Uji Coba 1-Click via Swagger UI

```powershell
.\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload
```

1. Buka Swagger UI di **`http://localhost:8000/docs`**.
2. Pilih endpoint **`POST /api/v1/scan/phase1`** $\rightarrow$ **Try it out**, lalu masukkan payload berikut:
   ```json
   {
     "url": "http://localhost:8000/mock-targets/rekrutmen_bintara_phish.html",
     "scan_id": "demo_001"
   }
   ```
3. Lihat hasil visual secara langsung di browser:
   - **Raw Capture (`1280x720`)**: `http://localhost:8000/static/screenshots/demo_001.png`
   - **Annotated DOM Capture (`1280x720`)**: `http://localhost:8000/static/annotated/demo_001_dom.png`

### D. Menjalankan dengan Docker

```bash
docker build -t visikartika-backend:phase1 .
docker run --rm -p 8000:8000 visikartika-backend:phase1
```

---

## 5b. Phase 2 — Triage Router, Whitelist `.mil.id`, Score Fusion & OpenWA

### Modul baru (Person B)
| File | Fungsi |
| :--- | :--- |
| `app/domain_guard.py` | Satu-satunya sumber whitelist resmi (`OFFICIAL_MIL_DOMAINS`) + deteksi *lookalike*: domain resmi yang ditempel (`tniad.mil.id.verify-login.com`), akhiran `.mil.id` palsu (`tniad-mil.id`), *typosquat* (`tnlad.com`), *homoglyph*/IDN (`tnïad.com`). |
| `app/scoring.py` | Rumus 45% Visual + 30% DOM + 25% Domain, ambang verdict (70/40), dan aturan override (*Identity-Domain Mismatch* ≥ 92, *Quishing* ≥ 90, *Visual Impersonation* ≥ 78). Aturan yang terpakai dikembalikan di field `applied_rules`. |
| `app/wa_triage.py` | Router triage lintas-gateway: **IMAGE** → `scan-image`, **URL** → `scan-url`, **COMMAND** (`portal`/`status`/`darurat`), **HELP**. Menolak `file://`, path lokal & alamat jaringan privat dari chat (kecuali `/mock-targets/` demo). |
| `app/webhook_openwa.py` | Webhook OpenWA `message.received`: balas 200 seketika lalu scan di *background* (mencegah retry ganda), dedupe `X-OpenWA-Idempotency-Key`, unduh media besar via API OpenWA, kirim **laporan teks + gambar bukti ber-bounding box (base64)** ke chat, verifikasi HMAC opsional. |
| `app/webhook_wa.py` | Fonnte (legacy) — tetap berfungsi, memakai triage yang sama. |

Endpoint bantu: `GET /api/v1/domain/check?url=...` dan `POST /api/v1/triage/preview`.

### Menjalankan OpenWA + Backend
```powershell
# Terminal 1 — gateway WhatsApp (folder openwa-gateway, port 2785)
cd openwa-gateway; npm run start:prod   # (dist/ sudah ter-build; pakai `npm start` untuk build ulang)
# Buka dashboard http://localhost:2785, buat/aktifkan sesi, scan QR dengan WhatsApp bot,
# lalu daftarkan webhook sesi ke http://localhost:8000/webhook/openwa (event: message.received).

# Terminal 2 — backend engine
.\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000
```
Isi `.env` (lihat `.env.example`): `OPENWA_API_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_WEBHOOK_SECRET` (opsional `OPENWA_ALLOW_GROUPS`, `OPENWA_SEND_EVIDENCE`).

📱 **Panduan uji chat ke nomor bot + troubleshooting: [`docs/TESTING_WHATSAPP.md`](docs/TESTING_WHATSAPP.md)**

🔒 **Keamanan (`app/security.py`)**: webhook hanya menerima request dari localhost kecuali disertai HMAC secret / token; scan API menolak `file://`, path lokal di luar folder project, dan alamat jaringan privat (SSRF); CORS dibatasi `CORS_ORIGINS`; nomor HP dimasking di log. Secret tidak boleh ditulis di kode — semua lewat `.env`.

### Pengujian Phase 2
```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest tests -q        # 82 test: whitelist, skor, triage, webhook OpenWA (fake gateway), keamanan
newman run postman\VisiKartika_Phase2.postman_collection.json   # atau Import ke Postman
```
Uji webhook tanpa mengirim WhatsApp: `POST /webhook/openwa?sync=true&dry_run=true`.

---

## 5c. Phase 3 & Phase 4 (Zuan) — Audit Akurasi/Latensi & Scanner Poster/QR (`/api/v1/scan-image`)

- **Laporan Audit Phase 3 (`docs/PHASE3_BENCHMARK_REPORT.md`)**:
  - **Akurasi Deteksi Multi-Slice**: **100.00% (`95/95` sampel)** — `TP=20, TN=75, FP=0, FN=0`, `ROC-AUC = 1.0000`
  - **Latensi Warm Playwright URL Scan**: **`P50 = 1.510s` / `P95 = 2.232s`** (`100%` lulus SLA `< 5.0s`)
  - **Latensi Multimodal Poster/Image Scan (`/api/v1/scan-image`)**: **`P50 = 1.592s` / `P95 = 1.873s`**
  - **Endpoint Telemetri**: `GET /api/v1/benchmark/phase3`
- **Multimodal Quishing & Poster Scanner (`Phase 4 — Zuan`)**:
  - **QR Quishing Decoder (`app/vision/ocr_quishing.py`)**: Hybrid OpenCV `QRCodeDetector` multi-pass + `PyZbar` (`libzbar0`).
  - **Poster & Screenshot OCR (`app/vision/image_analyzer.py`)**: Persistent Windows `Windows.Media.Ocr` (`~94ms`), Linux `tesseract-ocr` (`ind+eng`), serta *lazy-loaded* Deep Learning `EasyOCR` (`easyocr.Reader(['id', 'en'])`, opsional via `requirements-easyocr.txt` / `VK_OCR_BACKEND=easyocr`).

```powershell
# Menjalankan benchmark penuh Phase 3 (95 sampel + uji konkuren 4x)
python scripts/benchmark_phase3.py

# Menjalankan verifikasi Phase 4 Zuan (/api/v1/scan-image QR Quishing & Poster OCR)
python scripts/verify_phase4.py

# Menjalankan audit Phase 5 Zuan (Docker minimal footprint & isolasi SSRF/Chromium)
python scripts/verify_phase5.py
```

- **Optimasi Container Docker & Isolasi Chromium (`Phase 5 — Zuan`)**:
  - **Multi-Stage `Dockerfile` (`TORCH_PROFILE=none|cpu|gpu`)**: Menggunakan `python:3.12-slim-bookworm` + instalasi khusus **Chromium saja** (menghemat `>1 GB` dibanding image multi-browser), `tini` sebagai PID-1 *zombie process reaper*, pembatasan memori `MALLOC_ARENA_MAX=2` & thread CPU (`OMP_NUM_THREADS=2`), serta user non-root `pwuser` (`UID 10001`).
  - **Minimal Build Context (`.dockerignore`)**: Mengecualikan `frontend-soc/`, `node_modules/`, `openwa-gateway/`, `.venv/`, dan `storage/dataset/` sehingga konteks build hanya `~31 MB`.
  - **Hardened Runtime (`docker-compose.yml` & `railway.toml`)**: Mendukung *read-only rootfs*, `cap_drop: ALL`, `no-new-privileges:true`, `pids_limit: 256`, `shm_size: 256mb`, profil CPU maupun GPU NVIDIA (`--profile gpu`), serta pra-konfigurasi `CORS_ORIGINS` untuk `https://zero-day-phising-shield.vercel.app`.
  - **Zero-Trust Chromium Sub-Request Isolation (`app/sandbox/browser.py`)**: Pembatasan V8 Heap (`256 MB`), pemblokiran `ServiceWorker`/unduhan/popup/dialog trap, *auto-recycle* proses browser tiap 60 scan, serta pemblokiran *sub-request* SSRF ke `file://`, `169.254.169.254` (*cloud metadata*), `127.0.0.1`, dan jaringan privat RFC1918.

---

## 6. Skema Database Supabase (PostgreSQL + Realtime)

Jalankan *query* SQL berikut pada **Supabase SQL Editor** untuk mengaktifkan penyimpanan insiden dan pembaruan *real-time* ke Dashboard SOC:

```sql
-- 1. Tabel Referensi Portal Resmi TNI AD (Protected Brands)
CREATE TABLE official_portals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_name VARCHAR(150) NOT NULL,          -- Contoh: "Portal Rekrutmen Bintara TNI AD"
    official_domain VARCHAR(255) NOT NULL,      -- Contoh: "ad.rekrutmen-tni.mil.id"
    reference_screenshot_url TEXT NOT NULL,
    dom_signature JSONB,                        -- Ringkasan struktur tag HTML resmi
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Log Pemindaian & Insiden Phishing (Realtime SOC)
CREATE TABLE scan_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_url TEXT,
    reporter_source VARCHAR(50) DEFAULT 'WEB_SANDBOX', -- 'WHATSAPP_BOT', 'WEB_SANDBOX', 'BROWSER_EXT'
    reporter_unit VARCHAR(100) DEFAULT 'Simulasi Juri / Satuan Jajaran',

    -- Skor Komposit & Sub-Indikator (0 - 100)
    total_risk_score NUMERIC(5,2) NOT NULL,
    visual_similarity_score NUMERIC(5,2) NOT NULL,
    dom_anomaly_score NUMERIC(5,2) NOT NULL,
    domain_telemetry_score NUMERIC(5,2) NOT NULL,

    -- Hasil Deteksi & Bukti Forensik
    verdict VARCHAR(30) NOT NULL,               -- 'SAFE', 'SUSPICIOUS', 'CRITICAL_PHISHING'
    impersonated_target VARCHAR(150),           -- Nama portal resmi yang ditiru
    captured_screenshot_url TEXT,               -- URL screenshot dari Playwright
    annotated_bbox_url TEXT,                    -- Screenshot dengan Bounding Box merah/oranye
    detected_logos JSONB,                       -- Koordinat & confidence score logo TNI AD yang dicatut
    dom_findings JSONB,                         -- Detail tujuan eksfiltrasi form & indikator DOM

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aktifkan Realtime untuk tabel scan_incidents
ALTER PUBLICATION supabase_realtime ADD TABLE scan_incidents;
```

---

## 7. Timeline Eksekusi & Pembagian Tugas Tim (31 Okt – 15 Nov 2026)

Berdasarkan **Sprint Gantt & Timeline Tracker** (**21 Workstreams** & **7 Sync Milestones**, tenggat akhir pengumpulan karya: **15 November 2026 pukul 23:59 WIB**):

- **Person A (`Zuan`)**: *AI, Headless Sandbox & Computer Vision Engine (`backend-engine`)*
- **Person B (`Denin`)**: *SOC Command Platform, Supabase & WhatsApp Gateway Integrations (`frontend-soc`)*
- **Sync (`Zuan + Denin`)**: *Milestone Gateways & End-to-End Integration Verification*

| Fase | Tanggal | Assignee | Workstream / Fokus Pengerjaan | Deliverable Utama | Status |
| :---: | :---: | :---: | :--- | :--- | :---: |
| **Phase 1** | 31 Okt – 02 Nov | **Zuan** | Setup Playwright headless capture, simpan screenshot, dan ekstrak tag DOM form/input beserta *bounding box* OpenCV. | Playwright capture script, DOM extractor & OpenCV annotator (`/api/v1/scan/phase1`) | ✅ **Done** |
| **Phase 1** | 31 Okt – 02 Nov | **Denin** | Inisialisasi monorepo, setup database Supabase SQL, dan integrasi WhatsApp Gateway API. | Supabase DB schema & WA Gateway setup | ✅ **Done** |
| **Phase 1** | 31 Okt – 02 Nov | **Sync ★** | Uji konektivitas dasar: Webhook WA menerima pesan teks dan mengirim respon balik statis `"Pong"`. | Verified WA echo/Pong webhook integration | ✅ **Done** |
| **Phase 2** | 02 Nov – 04 Nov | **Zuan** | Bangun fungsi SSIM *visual similarity*, load template logo Kartika Eka Paksi, dan fungsi *auto-draw bounding box* merah pada logo. | SSIM similarity engine & logo bounding box detector (coarse-to-fine, ~0.6 s/gambar) | ✅ **Done** |
| **Phase 2** | 02 Nov – 04 Nov | **Denin** | Bangun router triage pesan (URL vs Gambar), domain whitelist `.mil.id`, dan formula kalkulasi skor gabungan. | `app/wa_triage.py`, `app/domain_guard.py`, `app/scoring.py` + migrasi Fonnte → OpenWA | ✅ **Done** |
| **Phase 2** | 02 Nov – 04 Nov | **Sync ★** | Uji kirim URL palsu via Postman ke FastAPI Person A; pastikan return JSON skor kemiripan dan screenshot ber-*bounding box*. | `postman/VisiKartika_Phase2.postman_collection.json` (37 assertion) + `pytest tests/` | ✅ **Done** |
| **Phase 3** | 05 Nov | **Zuan** | Evaluasi akurasi deteksi dan latensi capture Playwright (< 5 detik). | `docs/PHASE3_BENCHMARK_REPORT.md` (100% acc, P50 1.51s) | ✅ **Done** |
| **Phase 3** | 05 Nov | **Denin** | Rapikan layout Dashboard Next.js untuk monitoring insiden *real-time*. | Refined Next.js SOC incident monitoring UI | ⏳ Planned |
| **Phase 3** | 05 Nov | **Sync ★** | Ikuti **Webinar Pembekalan 2 Panitia Bersama**: sesuaikan fitur dengan arahan/kisi-kisi juri. | Briefing #2 alignment with jury criteria | ⏳ Planned |
| **Phase 4** | 06 Nov – 08 Nov | **Zuan** | Tambahkan `PyZbar` & `EasyOCR` untuk scan QR code / poster phishing pada endpoint `/api/v1/scan-image`. | Hybrid OpenCV/PyZbar + WinRT/Tesseract/EasyOCR (`/api/v1/scan-image`) | ✅ **Done** |
| **Phase 4** | 06 Nov – 08 Nov | **Denin** | Sambungkan endpoint FastAPI Person A ke webhook WhatsApp dan masukkan 5 halaman *mock phishing* legal ke `/public/mock-targets/`. | FastAPI-WA hook & 5 legal mock phishing targets | ⏳ Planned |
| **Phase 4** | 06 Nov – 08 Nov | **Sync ★** | Tes alur penuh: Kirim screenshot poster phishing ber-QR ke nomor WhatsApp $\rightarrow$ Bot membalas analisis lengkap dalam < 5 detik. | End-to-end QR phishing scan in < 5s response | ⏳ Planned |
| **Phase 5** | 09 Nov – 11 Nov | **Zuan** | Optimasi resource container Docker (PyTorch CPU/GPU minimal footprint), pastikan dependensi Chromium terisolasi. | Multi-stage `Dockerfile` (`none`/`cpu`/`gpu`), `docker-compose.yml`, & SSRF-isolated Chromium | ✅ **Done** |
| **Phase 5** | 09 Nov – 11 Nov | **Denin** | Buat halaman *Forensics Detail* (*Side-by-side comparison*), tombol *"1-Click Judge Test"*, dan tombol *Export DNS Sinkhole*. | Forensics side-by-side UI & 1-Click test button | ⏳ Planned |
| **Phase 5** | 09 Nov – 11 Nov | **Sync ★** | Deploy `backend-engine` ke VPS/Railway dan deploy `frontend-soc` ke Vercel; uji *public link*. | VPS backend & Vercel SOC production deployment | ⏳ Planned |
| **Phase 6** | 12 Nov – 13 Nov | **Zuan** | Tulis draft dokumen `PRE_EXISTING_DECLARATION.md` dan susun bagian arsitektur teknis pada slide presentasi. | `docs/PRE_EXISTING_DECLARATION.md` & `docs/TECH_ARCHITECTURE_SLIDES.md` | ✅ **Done** |
| **Phase 6** | 12 Nov – 13 Nov | **Denin** | Susun slide relevansi taktis militer, rekam skenario interaksi *live* (WhatsApp $\rightarrow$ Dashboard), dan siapkan thumbnail `1200x630 px`. | Tactical slide, live video demo & cover thumbnail | ⏳ Planned |
| **Phase 6** | 12 Nov – 13 Nov | **Sync ★** | Review slide bersama: pastikan deklarasi karya *pre-existing* transparan dan sesuai format Bab G panduan hackathon. | Joint slide review & Bab G compliance check | ⏳ Planned |
| **Phase 7** | 14 Nov – 15 Nov | **Zuan** | Verifikasi stabilitas sandbox saat diuji secara konkuren oleh *multiple user*; *final freeze* kode backend. | Sandbox concurrency load test & code freeze | ⏳ Planned |
| **Phase 7** | 14 Nov – 15 Nov | **Denin** | Edit dan finalisasi video demo YouTube (< 10 menit), ambil 5 screenshot resolusi tinggi, lengkapi *link* publik. | YouTube demo video (< 10m), 5 HD screenshots | ⏳ Planned |
| **Phase 7** | 14 Nov – 15 Nov | **Sync ★** | Submit final formulir lomba sebelum **15 November 2026 pukul 23:59 WIB**. | Final official submission dossier (< 23:59 WIB) | ⏳ Planned |

---

## 8. Kepatuhan Etika, Keamanan & Deklarasi Pre-Existing (Bab G & N)

1. **Keamanan Lingkungan Demo (Zero Active Malware)**:
   Seluruh target uji *phishing* (`rekrutmen_bintara_phish.html`, SSO tiruan, dan poster QR *Quishing*) merupakan halaman statis simulasi internal yang di-*host* secara lokal di dalam lingkungan demo. Sistem tidak mengeksekusi *malware* aktif dan tidak menyerang infrastruktur pihak ketiga mana pun.
2. **Transparansi Komponen Open-Source & Pre-Existing**:
   Sesuai Bab G buku panduan hackathon, seluruh pustaka *open-source* (`FastAPI`, `Playwright`, `OpenCV`, `PyTorch`, `YOLOv8`, `CLIP/DINOv2`, `EasyOCR`, `PyZbar`, `Next.js`, `Supabase`) serta referensi riset akademis (*Phishpedia / PhishIntention / VisualPhishNet / PhiUSIIL*) dideklarasikan secara terbuka pada dokumen `docs/PRE_EXISTING_DECLARATION.md`.

---

## 9. Daftar Kelengkapan Submission (Tenggat: 15 November 2026, 23:59 WIB)

- [ ] **Link Proyek Publik**: Frontend SOC (Vercel) & Backend Sandbox Engine (Railway / VPS Docker) untuk penjurian online (**16 November 2026**).
- [ ] **Thumbnail Karya**: `1200×630 px` (JPG/PNG/WebP, maks `500 KB`).
- [ ] **5 Screenshot Resolusi Tinggi**:
  1. Dashboard SOC Komando (peta ancaman & statistik *real-time*).
  2. *Side-by-Side Visual Forensics* (*bounding box* logo/form & skor kemiripan).
  3. Analisis *DOM Telemetry* & rincian eksfiltrasi formulir kredensial.
  4. Simulasi **WhatsApp Bot Lapor Cepat** oleh prajurit.
  5. Halaman *Automated Mitigation* (*DNS Sinkhole / Firewall Blocklist Generator*).
- [ ] **Video Demonstrasi YouTube**: Durasi maksimal 10 menit.
- [ ] **Slide Penjelasan & Dokumentasi**: Arsitektur, skenario taktis TNI AD, dan deklarasi *pre-existing*.
