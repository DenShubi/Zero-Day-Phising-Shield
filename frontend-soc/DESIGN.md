---
version: "1.0"
name: VisiKartika-Shield-Design-System
baseSystem: Linear (adapted via brand-design-md + bento + minimal + design-taste-frontend)
pageType: software
siteKind: software
description: >
  Sistem desain konsol komando SOC VisiKartika Shield untuk deteksi phishing zero-day,
  dioptimalkan untuk keterbacaan proyektor ruang sidang pada resolusi 1440x900 tanpa scroll
  kerangka luar. Mengadaptasi disiplin permukaan gelap bertingkat, garis rambut 1px, dan
  skala tipografi presisi dari Linear dengan komposisi Bento Grid asimetris berfokus tunggal.
  Bebas identitas portal pemerintah/hijau institusional, bebas warna ungu/violet Linear,
  dan bebas dekorasi generik.

colors:
  # Surface Luminance Ladder (Projector-calibrated dark surfaces)
  canvas: "#08090b"
  surface-0: "#0c0e12"
  surface-1: "#11141a"
  surface-2: "#171b23"
  surface-3: "#1e232d"
  surface-4: "#262c38"

  # Hairline Borders
  border-subtle: "#1b2029"
  border: "#242b37"
  border-strong: "#353f50"

  # Ink Hierarchy (WCAG AAA / AA verified across surface-0..surface-3)
  ink: "#f4f6f9"
  ink-secondary: "#c9d1dc"
  ink-muted: "#9aa6b8"
  ink-disabled: "#647084"

  # Product Accent — Cobalt Steel Azure (Zero violet, distinct from Verdict scale)
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-pressed: "#1e40af"
  on-accent: "#ffffff"
  accent-ink: "#60a5fa"
  accent-tint: "rgba(37, 99, 235, 0.14)"
  accent-border: "rgba(96, 165, 250, 0.35)"

  # Single-Source Verdict Scale (Defined ONCE in src/app/globals.css)
  verdict-safe: "#22c55e"
  verdict-safe-ink: "#4ade80"
  verdict-suspicious: "#f59e0b"
  verdict-suspicious-ink: "#fbbf24"
  verdict-critical: "#ff6363"
  verdict-critical-ink: "#ff8080"

  # Single-Source Annotation Layers (Matched to backend OpenCV PNG evidence)
  layer-logo: "#ed1c24"
  layer-qr: "#d228d2"
  layer-form: "#ffa500"
  layer-input: "#ef4444"

  # Print Media Tokens (@media print)
  print-canvas: "#ffffff"
  print-surface: "#f8fafc"
  print-ink: "#0f172a"
  print-muted: "#475569"
  print-border: "#cbd5e1"

typography:
  fontSans: "Geist Sans (next/font/local -> public/fonts/geist-*.woff2)"
  fontMono: "Geist Mono (next/font/local -> public/fonts/geist-mono-*.woff2)"
  display-xl:
    fontFamily: Geist Sans
    fontSize: 72px
    fontWeight: 600
    lineHeight: 1.00
    letterSpacing: -0.04em
    fontVariantNumeric: tabular-nums
  display-lg:
    fontFamily: Geist Sans
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -0.03em
    fontVariantNumeric: tabular-nums
  display-md:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.025em
    fontVariantNumeric: tabular-nums
  headline:
    fontFamily: Geist Sans
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.02em
  section-title:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.01em
  url-input:
    fontFamily: Geist Mono
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.01em
  body:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.005em
  ui:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: 0em
  label:
    fontFamily: Geist Sans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0.02em
  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
    fontVariantNumeric: tabular-nums

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  xxxl: 48px
  bento-gap: 14px
  frame-padding: 20px
  sidebar-expanded: 252px
  sidebar-rail: 64px

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  pill: 9999px

elevation:
  shadow: none
  specular-top: "inset 0 1px 0 rgba(255, 255, 255, 0.04)"
  focus-ring: "0 0 0 2px #08090b, 0 0 0 4px #60a5fa"

motion:
  ease-out: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  hover-in: 140ms
  hover-out: 200ms
  press: 90ms
  panel-switch: 160ms
---

# DESIGN.md — VisiKartika Shield SOC Console

Dokumen ini mengunci keputusan sistem desain untuk redesign total lapisan presentasi `frontend-soc/`. Seluruh komponen, token CSS di `src/app/globals.css`, dan komposisi keenam panel wajib mematuhi spesifikasi ini tanpa pengecualian.

---

## 1. Filosofi Visual & Identitas Produk

1. **Adaptasi Sistem Linear, Bukan Branding Linear**: Mengadopsi disiplin arsitektur antarmuka Linear—tangga luminansi permukaan gelap (`surface ladder`), batas garis rambut `1px` (`hairline borders`), tipografi presisi dengan *negative tracking* terukur pada angka besar, serta penggunaan warna aksen yang sangat hemat. Logo dan warna ungu/lavender khas Linear (`#5e6ad2`) **dilarang keras**.
2. **Identitas Produk Mandiri ("VisiKartika Shield")**:
   - **Brand Mark**: Inline SVG geometris kustom (`VisiKartikaMark`) berbentuk perisai faset prisma dengan garis bidik optik presisi (`stroke` + bidang faset bersih)—bukan kotak berisi huruf `"VK"` dan bukan emoji.
   - **Wordmark**: `VisiKartika Shield` dalam `Geist Sans` `15px` `font-semibold` dengan `letter-spacing: -0.025em`.
   - **De-institusionalisasi Chrome**: Warna hijau institusi lama (`#1f7a4d`) dan badge unit di navigasi atas dihapus sepenuhnya. Nama `PUSSIBERAD TNI AD` hanya muncul sebagai metadata kecil di footer sidebar (`13px` muted) dan pada kop dokumen saat `@media print`.
3. **Komposisi Bento + Minimal (`design-taste-frontend`)**:
   - Setiap panel disusun sebagai **Bento Grid asimetris** dengan **satu focal point dominan** dan modul-modul satelit pendukung dalam satu layar penuh `1440×900` tanpa *vertical scroll* pada kerangka halaman.
   - Maksimal **2 tingkat sarang kotak** (*box nesting*: Bento Card -> Sub-modul/Baris) sesuai aturan anti-slop `taste-skill`.
   - Dilarang menggunakan *glassmorphism*, *neobrutalism*, *retro*, *neon*, efek *glow* berlebihan, *caption* di bawah gambar/visual (`<figcaption>`), ataupun *progress/range slider* HTML mentah yang melanggar `consistency.mjs`.

---

## 2. Palet Warna Final (Nilai Hex Terkunci)

Seluruh warna didefinisikan satu kali di `src/app/globals.css` (`:root` + `@theme inline`). Tidak boleh ada hex verdict atau anotasi yang di-*hardcode* di dalam komponen React.

### 2.1 Tangga Permukaan Gelap (Surface Luminance Ladder)

Dirancang khusus agar pemisahan antar-panel Bento tetap tegas pada proyektor ruang sidang yang cenderung mengompresi area hitam pekat:

| Token CSS | Nilai Hex | Peran Spesifik |
|---|---|---|
| `--canvas` / `--background` | `#08090b` | Latar dasar aplikasi di belakang grid Bento |
| `--surface-0` | `#0c0e12` | Permukaan sidebar permanen & bilah atas kontekstual |
| `--surface` / `--surface-1` | `#11141a` | Kartu Bento primer (wadah modul utama) |
| `--surface-raised` / `--surface-2` | `#171b23` | Header tabel *sticky*, sub-modul internal, kondisi *hover* kartu |
| `--surface-3` | `#1e232d` | Baris aktif/terpilih, kontrol input saat fokus, tombol sekunder *hover* |
| `--surface-4` | `#262c38` | *Popover* status kesehatan sistem & *tooltip* teknis |

### 2.2 Garis Rambut (Hairline Borders)

| Token CSS | Nilai Hex | Peran Spesifik |
|---|---|---|
| `--border-subtle` | `#1b2029` | Pemisah baris tabel internal & pembagi grup sidebar |
| `--border` | `#242b37` | Garis tepi `1px` standar seluruh kartu Bento & field input |
| `--border-strong` | `#353f50` | Garis tepi saat *hover*, kartu fokus utama, dan bingkai kanvas bukti |

### 2.3 Hierarki Tinta (Ink Hierarchy — Terverifikasi WCAG)

| Token CSS | Nilai Hex | Rasio Kontras (di `#11141a`) | Peran Spesifik |
|---|---|---|---|
| `--foreground` | `#f4f6f9` | `15.8 : 1` (AAA) | Angka hero, judul panel, URL target, nilai tabel utama |
| `--muted-strong` | `#c9d1dc` | `11.1 : 1` (AAA) | Teks isi laporan, temuan forensik, label navigasi aktif/hover |
| `--muted` | `#9aa6b8` | `7.5 : 1` (AAA) | Label kolom, metadata waktu WIB, teks sekunder (`>= 7.1:1` di `--surface-2`) |
| `--ink-disabled` | `#647084` | `3.5 : 1` | Hanya untuk kontrol `disabled` non-interaktif & dekorasi garis bantu |

### 2.4 Warna Aksen Produk — Cobalt Steel Azure

Dipilih agar tajam di atas permukaan gelap, bebas nuansa ungu/violet, dan tidak bertabrakan dengan warna *verdict* (hijau/kuning-amber/merah) maupun anotasi bukti:

| Token CSS | Nilai | Rasio Kontras | Peran Spesifik |
|---|---|---|---|
| `--accent` | `#2563eb` | `5.17 : 1` dgn `#ffffff` | Tombol aksi primer ("Pindai Target", "Unduh Blocklist"), indikator rute aktif |
| `--accent-hover` | `#1d4ed8` | `6.69 : 1` dgn `#ffffff` | Kondisi *hover* tombol primer (tetap kontras tinggi dengan teks putih) |
| `--accent-pressed` | `#1e40af` | `8.60 : 1` dgn `#ffffff` | Kondisi tekan (*active/pressed*) tombol primer |
| `--on-accent` | `#ffffff` | — | Teks & ikon di atas tombol `--accent` |
| `--accent-ink` | `#60a5fa` | `6.85 : 1` di `#11141a` | Tautan aksi teknis, sorotan parameter aktif, *focus ring*, aksen mark SVG |
| `--accent-tint` | `rgba(37, 99, 235, 0.14)` | — | Latar item sidebar aktif & chip filter terpilih |
| `--accent-border` | `rgba(96, 165, 250, 0.35)` | — | Garis tepi elemen terpilih / fokus aktif |

### 2.5 Skala Verdict Terpusat (Single Source of Truth)

Didefinisikan satu kali di `src/app/globals.css`. Wajib selalu dipasangkan dengan **ikon SVG + label teks Bahasa Indonesia** (warna tidak pernah menjadi satu-satunya pembawa makna):

| Token CSS | Nilai Hex | Varian Teks Gelap (`*-ink`) | Varian Tint Latar (`12%`) | Makna Operasional |
|---|---|---|---|---|
| `--verdict-safe` | `#22c55e` | `#4ade80` | `rgba(34, 197, 94, 0.12)` | `SAFE` — Aman (+ ikon `ShieldCheck`) |
| `--verdict-suspicious` | `#f59e0b` | `#fbbf24` | `rgba(245, 158, 11, 0.12)` | `SUSPICIOUS` — Mencurigakan (+ ikon `AlertTriangle`) |
| `--verdict-critical` | `#ff6363` | `#ff8080` | `rgba(255, 99, 99, 0.14)` | `CRITICAL_PHISHING` — Phishing Kritis (+ ikon `OctagonAlert`) |

### 2.6 Token Layer Anotasi Bukti Visual (Terkunci ke OpenCV Backend)

Dipertahankan selaras dengan warna BGR yang dibakar oleh `app/services/visual_ forensics` ke berkas PNG bukti:

| Token CSS | Nilai Hex | Layer Deteksi |
|---|---|---|
| `--layer-logo` | `#ed1c24` | Pencocokan Logo Institusional (Crimson) |
| `--layer-qr` | `#d228d2` | Dekode Payload QR / Quishing (Magenta) |
| `--layer-form` | `#ffa500` | Formulir Kredensial Mencurigakan (Amber) |
| `--layer-input` | `#ef4444` | Kolom Input Sensitif / Password & NRP (Red) |

---

## 3. Skala Tipografi (Offline `next/font/local`)

- **Sumber Font Offline**: Berkas `geist-latin.woff2`, `geist-latin-ext.woff2`, `geist-mono-latin.woff2`, dan `geist-mono-latin-ext.woff2` disajikan lokal dari `public/fonts/` melalui `next/font/local` di `src/app/layout.tsx`. Nol request jaringan saat *build* maupun saat demo *offline*.
- **Disiplin Angka**: Seluruh metrik KPI, skor risiko (`0–100`), latensi (`ms`), stempel waktu, dan sel matriks akurasi **wajib** memakai `font-variant-numeric: tabular-nums`.
- **Ukuran Minimum**: Paragraf teks bacaan (*running body copy*) wajib `16px` untuk memenuhi keterbacaan proyektor 5 meter sekaligus lolos aturan `body-size` pada `consistency.mjs`. Tidak ada teks di bawah `13px`.

| Token Skala | Keluarga Font | Ukuran | Berat | Line Height | Tracking | Penggunaan Spesifik |
|---|---|---|---|---|---|---|
| `display-xl` | `Geist Sans` | `72px` (`4.5rem`) | `600` | `1.00` | `-0.04em` | Angka hero tunggal di Pusat Komando: jumlah **Insiden Kritis Aktif** (`tabular-nums`) |
| `display-lg` | `Geist Sans` | `48px` (`3.0rem`) | `600` | `1.05` | `-0.03em` | Angka sel utama **Confusion Matrix** (Audit) & Skor Risiko Akhir (`0–100`) di Forensik |
| `display-md` | `Geist Sans` | `32px` (`2.0rem`) | `600` | `1.15` | `-0.025em` | Metrik satelit pilihan (mis. F1-Score, Waktu Deteksi P50, Total Insiden) |
| `headline` | `Geist Sans` | `22px` (`1.375rem`) | `600` | `1.25` | `-0.02em` | Judul utama panel aktif (`h1`) di bilah header panel |
| `section-title` | `Geist Sans` | `16px` (`1.0rem`) | `600` | `1.35` | `-0.01em` | Judul kartu Bento (`h2`) |
| `url-input` | `Geist Mono` | `18px` (`1.125rem`) | `400` | `1.40` | `-0.01em` | Field input URL utama di Konsol Pemindaian |
| `body` | `Geist Sans` | `16px` (`1.0rem`) | `400` | `1.50` | `-0.005em` | Paragraf penjelasan, ringkasan temuan, pesan gelembung chat WhatsApp, *callout* |
| `ui` / `button` | `Geist Sans` | `14px` (`0.875rem`) | `500` | `1.40` | `0em` | Item navigasi sidebar, tombol aksi, tab filter, baris tabel standar |
| `label` | `Geist Sans` | `13px` (`0.8125rem`) | `500` | `1.30` | `+0.02em` | Label grup sidebar (*sentence case*), header kolom tabel, badge status/verdict |
| `mono` | `Geist Mono` | `13px–14px` | `400` | `1.45` | `0em` | URL ter-defang (`hxxps://`), domain, hash SHA-256, ASN, log JSON/blocklist, latensi `ms` |

---

## 4. Skala Spacing, Grid Bento & Disiplin Viewport `1440×900`

### 4.1 Skala Spacing (Basis 4px)
- `4px` (`xxs`): Jarak ikon-ke-teks di dalam badge/chip.
- `8px` (`xs`): Jarak antar-chip atau elemen kontrol sejajar.
- `12px` (`sm`): Padding vertikal baris tabel padat & item navigasi sidebar.
- `14px` (`bento-gap`): Jarak seragam antar-kartu dalam grid Bento (`gap-3.5`).
- `16px` (`md`): Padding standar kartu Bento padat (`p-4`).
- `20px` (`lg`): Padding tepi luar area kerja utama (`px-5 py-4`) & kartu Bento hero (`p-5`).
- `24px` (`xl`): Pemisah antar-blok mayor di dalam kartu hero.
- `32px` (`xxl`) & `48px` (`xxxl`): Ruang bernapas di sekitar focal point input Konsol Pemindaian.

### 4.2 Kontrak Kerangka Satu Layar (`1440×900`)
- Pada layar desktop (`>= 1024px`), kerangka luar memakai `h-[100svh] overflow-hidden grid` dengan kolom `[252px_minmax(0,1fr)]` (atau `[64px_minmax(0,1fr)]` saat sidebar di-*collapse*).
- Tepi kiri dan kanan konten di dalam area utama sejajar presisi (`equal edges`).
- **Nol scroll vertikal halaman**: Setiap panel memiliki header kompak tetap (`56px`) dan kanvas Bento `flex-1 min-h-0`. Daftar panjang (feed insiden, tabel baseline audit, daftar IOC mitigasi, detail temuan forensik, riwayat chat WhatsApp) melakukan scroll di dalam kontainer internalnya sendiri (`.vk-scroll` dengan scrollbar tipis `6px`).
- Pada layar tablet/mobile (`< 1024px`), layout beradaptasi menjadi satu kolom mengalir dengan navigasi laci (*drawer*) agar tetap responsif di `768px` dan `390px`.

---

## 5. Skala Radius & Elevasi

### 5.1 Skala Radius (Sharp-Technical)
- `xs` (`4px`): Kotak centang (*checkbox*), swatch warna layer anotasi, bar segmen kecil.
- `sm` (`6px`): Chip preset, tombol ikon kecil, kbd tag.
- `md` (`8px`): Tombol aksi primer/sekunder, item navigasi sidebar, field input, sel matriks.
- `lg` (`12px`): Seluruh kartu Bento utama, kontainer modal/popover, bingkai kanvas bukti.
- `pill` (`9999px`): Badge verdict (`VerdictBadge`) dan titik indikator status koneksi.

### 5.2 Disiplin Elevasi (Nol Drop Shadow Gelap)
- **Tanpa `box-shadow` kabur**: Tidak ada bayangan hitam menyebar di atas kanvas gelap.
- Kedalaman dibangun murni lewat:
  1. Perbedaan luminansi permukaan (`#08090b` -> `#11141a` -> `#171b23` -> `#1e232d`).
  2. Garis tepi `1px solid var(--border)` yang menguat menjadi `var(--border-strong)` saat *hover*.
  3. Kilau tepi atas halus `inset 0 1px 0 rgba(255, 255, 255, 0.04)` pada kartu Bento primer.

---

## 6. Aturan Motion & Micro-Interactions

1. **Kurva & Durasi**:
   - Kurva tunggal: `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`.
   - *Hover masuk*: `140ms` (perubahan warna permukaan/border & angkat halus `translateY(-2px)` khusus pada kartu tautan/interaktif).
   - *Hover keluar*: `200ms`.
   - *Tekan klik (Press)*: `90ms` dengan langkah taktil `translateY(1px) scale(0.985)` pada seluruh tombol interaktif.
   - *Transisi lebar sidebar*: `180ms cubic-bezier(0.2, 0.8, 0.2, 1)`.
2. **Indikator Realtime Tenang**:
   - Tidak ada teks `"LIVE"` berkedip cepat. Status terhubung ditandai titik hijau tenang `8px` dengan label teks jelas (`Realtime aktif` / `Mode sampel offline`).
3. **Larangan Keras**:
   - Nol animasi berbasis scroll (*scroll-reveal*, *parallax*, *pinned scrolljacking*).
   - Wajib mematuhi `@media (prefers-reduced-motion: reduce)` yang mematikan seluruh transisi transformasi dan animasi.

---

## 7. Arsitektur Satu Route (`/`) & Blueprint 6 Panel Bento

### 7.1 Navigasi Sidebar Permanen & Deep-Linking
- **Satu Route**: `src/app/page.tsx` melayani `/` dan membaca state via `useSearchParams()` (dibungkus `<Suspense>` agar kompatibel dengan `output: 'export'`) serta memperbarui URL secara instan via `router.replace(..., { scroll: false })`.
- **Skema Query Param**:
  - `/?view=komando` (default saat `/` dibuka tanpa parameter)
  - `/?view=pemindaian`
  - `/?view=forensik&insiden=<id>` (otomatis terbuka seusai pemindaian atau saat baris insiden diklik)
  - `/?view=audit`
  - `/?view=mitigasi&host=<hostname>` (menerima indikator kritis langsung dari Forensik / Lapor Cepat)
  - `/?view=lapor-cepat`
- **Struktur Sidebar (`252px` -> `64px` rail)**:
  - **Header**: `VisiKartikaMark` + wordmark `VisiKartika Shield` + tombol *collapse* rail.
  - **Grup 1 — Operasi**: `Pusat Komando`, `Konsol Pemindaian`.
  - **Grup 2 — Analisis**: `Forensik`, `Audit Akurasi`.
  - **Grup 3 — Tindakan**: `Mitigasi`, `Simulasi Lapor Cepat`.
  - **Footer**: Komponen `HealthStrip` (status Engine API + Supabase dengan *popover* detail ke atas) dan baris metadata kecil `PUSSIBERAD TNI AD`.

### 7.2 Blueprint Hierarki Tiap Panel (`1440×900`)

1. **Pusat Komando (`komando`) — Bento 12 Kolom (Kiri 7 Kolom Analitik, Kanan 5 Kolom Feed Insiden Tinggi Penuh)**:
   - **Focal Point Hero (Kiri-Atas)**: Kartu utama menampilkan angka `72px` (`display-xl`, `tabular-nums`) untuk **Insiden Phishing Kritis Aktif**, didampingi tombol pintas cepat ke Forensik/Mitigasi dan 4 metrik satelit berukuran sekunder (`24px–28px`: Total Insiden, Mencurigakan, Aman, Waktu Deteksi P50).
   - **Distribusi Verdict (Kiri-Tengah)**: **Satu bar horizontal bertumpuk** (*single stacked bar*) proporsional menggunakan `--verdict-critical`, `--verdict-suspicious`, dan `--verdict-safe` dengan legenda ikon + angka + persentase yang terbaca sekali lihat.
   - **Sebaran Asal Laporan (Kiri-Bawah)**: Visualisasi jujur berupa **ranking horizontal bar satuan pelapor** terpetakan (`locateUnit`) plus kartu sorotan khusus **"Asal tidak terpeta (Kanal WhatsApp/Umum)"** agar mayoritas laporan kanal cepat terlihat transparan.
   - **Feed Insiden Realtime (Kanan, Tinggi Penuh)**: Daftar insiden dengan filter verdict, indikator status koneksi yang tenang, dan scroll internal. Klik baris langsung membuka `/?view=forensik&insiden=<id>` tanpa reload.

2. **Konsol Pemindaian (`pemindaian`) — Fokus Tunggal Dominan**:
   - **Hero Input URL**: Bar input URL ekstra besar (`56px` tinggi, font `Geist Mono` `18px`) dengan satu tombol aksi primer Cobalt Azure (`Pindai Target`) dan pratinjau telemetri domain instan (`DomainPreview`: skema, host, TLD, punycode/homoglyph, entropi) tepat di bawahnya.
   - **Chip Uji Cepat Juri**: Deretan chip horizontal ringkas berlabel opsional di bawah input utama untuk menyuntikkan skenario demo sekali klik.
   - **Baris Sekunder Kompak (2 Kolom Bento)**: Di kiri, *dropzone* unggah/tempel gambar poster/screenshot (untuk deteksi OCR & QR/quishing) yang ringkas namun fungsional; di kanan, pemilih Satuan Pelapor opsional & ringkasan alur otomatis.
   - **Stepper Progres Horizontal**: Saat pemindaian berjalan (atau sebagai pratinjau tahapan siap pakai), 4 tahap pipeline ditampilkan sebagai **stepper horizontal berukuran tegas** dengan nomor tahap, ikon status, dan label yang terbaca dari jarak 5 meter. Selesai pindai -> transisi mulus ke panel `Forensik` dengan hasil tersebut.

3. **Forensik (`forensik`) — Bukti Visual `>= 62%` Lebar + Collapsible Inspector Rail**:
   - **Toolbar Bukti Kontekstual**: Pemilih insiden cepat (jika ingin berpindah antar-insiden terbaru), URL ter-defang (`hxxps://`), `VerdictBadge`, aksi primer **Kirim Host ke Mitigasi** (`/?view=mitigasi&host=...`), tombol **Cetak Laporan** (`window.print()`), dan tombol *collapse* rail samping.
   - **Kanvas Utama (`>= 62%` lebar, atau `100%` saat rail di-*collapse*)**:
     - Tab mode bukti: **Bukti Beranotasi (`BBoxOverlay`)** dengan chip toggle layer (`Logo`, `QR`, `Form`, `Input`) interaktif tanpa `<figcaption>`, dan **Komparasi Diff Visual (`SideBySide`)** terhadap portal resmi yang menampilkan garis belah interaktif (*split curtain* via pointer/tombol persentase cepat tanpa `<input type="range">`) serta penanda ketidakcocokan domain/visual.
     - Di bawah kanvas bukti (dalam scroll internal terukur): grid ringkas **Telemetri DOM (`DomTelemetry`)**, **Multimodal OCR & QR (`MultimodalPanel`)**, dan **Rantai Redirect (`RedirectLadder`)** yang terhubung lewat *cross-highlight* dengan bounding box.
   - **Rail Samping Kanan (`~38%` lebar, collapsible)**: Skor risiko akhir (`48px` `tabular-nums`) + `ScoreBreakdown` (3 komponen bobot), daftar **Temuan Kunci**, dan `LatencyWaterfall` per-tahap.
   - **Mode Cetak (`@media print`)**: Sidebar dan tombol interaktif disembunyikan (`.vk-no-print`); kop laporan resmi `PUSSIBERAD TNI AD — VisiKartika Shield`, skor, temuan, dan bukti tercetak rapi di atas latar putih `#ffffff`.

4. **Audit Akurasi (`audit`) — Confusion Matrix Hero + Tabel Sticky**:
   - **Baris Atas (Hero Bento)**: Di kiri (7 kolom), **Confusion Matrix 2×2** dengan angka `48px` (`display-lg`, `tabular-nums`), pembeda semantik jelas antara diagonal benar (TP/TN) vs kesalahan kritis (FN/FP) lengkap dengan ikon + rasio FNR/FPR. Di kanan (5 kolom), metrik kunci dataset (Akurasi, Precision, Recall, F1-Score) dan perbandingan SLA Latensi P50/P95 terhadap target anggaran waktu.
   - **Baris Bawah (Scroll Internal)**: Tabel perbandingan metode **Baseline vs VisiKartika Fusion** dan irisan per kategori serangan dengan `sticky top-0` header dan angka rata kanan `tabular-nums`.

5. **Mitigasi (`mitigasi`) — Ekspor Blocklist Operasional**:
   - **Callout Simulasi**: Banner peringatan simulasi yang tegas di bagian atas panel (ikon perisai peringatan + teks jelas bahwa daftar siap diunduh tanpa mengubah DNS produksi otomatis), tenang dan tidak berisik.
   - **Bento 2 Kolom (Kiri 7 Kolom Tabel IOC, Kanan 5 Kolom Generator & Pratinjau Format)**:
     - **Kiri**: Tabel indikator kritis/mencurigakan dengan *checkbox* seleksi, pencarian cepat, sorotan otomatis bila dibuka dari Forensik (`?view=mitigasi&host=...`), dan scroll internal ber-header *sticky*.
     - **Kanan**: Kartu pemilih 4 format ekspor (`Plain Host List`, `BIND RPZ`, `dnsmasq`, `pf table`) masing-masing dengan **satu aksi unduh yang jelas**, jumlah host terpilih, serta jendela pratinjau kode `Geist Mono` siap salin.

6. **Simulasi Lapor Cepat (`lapor-cepat`) — Sebab-Akibat Kanal WhatsApp ke Pipeline SOC**:
   - **Bento 2 Kolom Seimbang (Kiri 6 Kolom Chat Autentik, Kanan 6 Kolom Telemetri Pipeline Langsung)**:
     - **Kiri**: Antarmuka percakapan WhatsApp yang autentik namun bersih (bebas hydration mismatch SSR pada timestamp), chip skenario pesan prajurit, input pesan bebas, dan balasan otomatis bot lengkap dengan `VerdictBadge` serta tombol pintas **Buka di Forensik** / **Masukkan ke Mitigasi**.
     - **Kanan**: Panel **Alur Eksekusi Pipeline SOC** yang memvisualisasikan hubungan sebab-akibat secara langsung setiap kali pesan dikirim: (1) Ekstraksi URL & Triase Pesan -> (2) Eksekusi Mesin (`Full Sandbox` vs `Lightweight Heuristics` / `Offline Sample`) -> (3) Fusi Skor Risiko & Temuan Utama -> (4) Sinkronisasi Tiket Insiden & Rekomendasi Blokir.

---

## 8. Daftar Komponen (Component Inventory)

| Modul / Path | Status | Peran dalam Sistem Desain Baru |
|---|---|---|
| `src/components/ui/icons.tsx` | **Baru** | Satu-satunya sumber seluruh ikon inline SVG + `VisiKartikaMark` kustom |
| `src/lib/panel-route.ts` | **Baru** | Helper tipe & builder query param deep-link (`view`, `insiden`, `host`) |
| `src/lib/i18n/id.ts` | **Diperluas** | Satu-satunya sumber seluruh teks UI Bahasa Indonesia (nol string *hardcoded* di JSX) |
| `src/components/shell/AppShell.tsx` | **Redesign** | Kerangka `100svh` satu halaman + sidebar kiri permanen *collapsible* (`Operasi`, `Analisis`, `Tindakan`) + kop cetak |
| `src/components/shell/HealthStrip.tsx` | **Redesign** | Footer status Engine API & Supabase di dasar sidebar dengan *popover* detail |
| `src/components/ui/VerdictBadge.tsx` | **Redesign** | Badge verdict terpusat (`--verdict-*`) dengan ikon SVG dari `icons.tsx` + label teks |
| `src/components/ui/ScoreBreakdown.tsx` | **Redesign** | Bar rincian skor 3 komponen tanpa elemen `<progress>`/`<meter>` mentah |
| `src/components/incidents/IncidentFeed.tsx` | **Redesign** | Feed insiden tinggi penuh dengan scroll internal, indikator tenang, & deep-link panel |
| `src/components/sandbox/ScanConsole.tsx` | **Redesign** | Hero URL input dominan + chip uji juri opsional + dropzone gambar sekunder kompak |
| `src/components/sandbox/ScanProgress.tsx` | **Redesign** | Stepper progres horizontal besar yang terbaca dari jarak 5 meter |
| `src/components/sandbox/DomainPreview.tsx` | **Redesign** | Bar telemetri domain instan (`tabular-nums`, peringatan punycode/entropi) |
| `src/components/forensics/BBoxOverlay.tsx` | **Redesign** | Kanvas bukti `>=60%` lebar dengan toggle layer anotasi interaktif, bebas `<figcaption>` |
| `src/components/forensics/SideBySide.tsx` | **Redesign** | Komparator *visual diff* terhadap portal resmi tanpa `<figcaption>` & tanpa `<input type="range">` |
| `src/components/forensics/DomTelemetry.tsx` | **Redesign** | Modul telemetri form/origin/TLS dengan *cross-highlight* layer |
| `src/components/forensics/MultimodalPanel.tsx` | **Redesign** | Modul bukti OCR & dekode QR/quishing dengan *cross-highlight* layer |
| `src/components/forensics/RedirectLadder.tsx` | **Redesign** | Visualisasi lompatan HTTP redirect ter-defang |
| `src/components/forensics/LatencyWaterfall.tsx` | **Redesign** | Grafik air terjun latensi tahap pemindaian di rail samping Forensik |
| `src/components/audit/ConfusionMatrix.tsx` | **Redesign** | Hero matriks 2×2 angka `48px` dengan kontras semantik diagonal & rasio FNR/FPR |
| `src/components/audit/BaselineTable.tsx` | **Redesign** | Tabel perbandingan metode ber-header *sticky* & angka `tabular-nums` |
| `src/components/whatsapp/WaSimulator.tsx` | **Redesign** | Simulator chat WhatsApp bebas SSR hydration error + panel sebab-akibat Pipeline SOC |
| `src/components/whatsapp/WaMarkup.tsx` | **Pertahankan** | Parser pemformatan teks pesan bot (`*tebal*`, `_miring_`, `` `kode` ``) |
| `src/app/page.tsx` | **Redesign** | Entrypoint tunggal `/` (`<Suspense>` + switcher keenam panel Bento) |
