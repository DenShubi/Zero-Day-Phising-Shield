---
version: "2.0"
name: VisiKartika-Shield-Architectural-Security-Ledger
archetype: Architectural Security Ledger (SecretX Endpoints Inventory + TasteSkill Anti-Slop)
dial: "ENERGY=4, RHYTHM=7, MOTION=2"
pageType: software
siteKind: software
colorScheme: "dark light (Dual Theme: Dark Ops Carbon + Projector Paper Light)"
---

# DESIGN.md: VisiKartika Shield Architectural Security Ledger

Dial: `ENERGY=4, RHYTHM=7, MOTION=2`

Dokumen ini mengunci sistem desain generasi ke-2 untuk `frontend-soc/` pada platform **VisiKartika Shield**. Spesifikasi ini menggantikan tata letak kartu Bento sebelumnya dengan arsitektur **Architectural Security Ledger** (terinspirasi inventaris endpoint keamanan kelas produksi seperti *SecretX Endpoints Inventory*): bingkai struktural rata (*flush ruled panes*) berbatas garis tipis `1px`, tabel inventaris berdensitas tinggi, geometri sudut tajam `0px-4px`, dukungan nyata **Dual Theme (Dark Ops + Projector Light)**, dan disiplin warna monokrom teknikal dengan satu aksen sinyal tunggal.

## 1. Prinsip Utama Anti-Slop

1. **Nol Kartu Bento Mengambang**: Seluruh layar disusun sebagai bidang struktural rata (*flush ledger grid*) yang dibagi oleh garis `1px` (`border-b`, `border-r`, `divide-x`, `divide-y`). Tidak ada mosaik kotak `rounded-xl` mengambang di atas ruang kosong.
2. **Nol Garis Samping Berwarna (`R-01`)**: Dilarang memakai `border-l-2` atau `border-l-4` berwarna pada kartu, navigasi, *callout*, maupun baris aturan. Status ditunjukkan melalui permukaan struktural, garis `1px` utuh, ikon geometris `12px-16px`, dan label teks eksplisit.
3. **Geometri Sudut Tajam (`0px-4px`) & Nol Pill Kapsul (`R-09`)**:
   - Bingkai panel, strip metrik, dan pembagi ruang kerja: `0px` (rata tepi).
   - Kontrol interaktif (`button`, `input`, `select`, blok kode): `4px` (`rounded-[4px]`).
   - Tag status dan *verdict* (`VerdictBadge`, filter layer bukti): `3px` (`rounded-[3px]`) berbentuk tag teknis persegi panjang dengan tipografi *monospace* kapital. Kapsul `rounded-full` dilarang (kecuali titik indikator bundar `6px-8px`).
4. **Disiplin Warna Ketat (`R-29`)**:
   - **90% Monokrom Karbon / Kertas Teknikal**: Aksi primer memakai kontras tinta terbalik (*inverted monochrome ink*: `#EFECE6` di atas gelap, `#141619` di atas terang), bukan tombol biru SaaS (`#2563eb`).
   - **1 Aksen Sinyal Teknis (*Mineral Petrol Teal*)**: Dipakai hemat (`<= 5%` area layar) untuk cincin fokus `:focus-visible`, garis bidik optik *visual diff*, dan indikator aktif.
   - **Skala Semantik Verdict Terpusat**: Warna merah/amber/hijau hanya muncul ketika membawa makna status insiden nyata, selalu didampingi ikon SVG dan label teks.
5. **Dual Theme Nyata untuk Operasi & Proyektor (`R-21`, `R-34`)**:
   - **Dark Ops Mode (`data-theme="dark"`, bawaan)**: Dikalibrasi untuk ruang operasi SOC tanpa abu-abu kusam.
   - **Projector Light Mode (`data-theme="light"`)**: Permukaan kertas batu hangat (`#F5F4F0` / `#FFFFFF`) ber-kontras tinggi (`18.13:1`) agar tetap tajam di proyektor ruang sidang terang.
   - Sakelar tema bekerja instan tanpa *flash* (FOUC script sinkron + `<meta name="color-scheme">`).

## 2. Token Warna Terkunci & Rasio Kontras WCAG (Terverifikasi `contrast-check.py`)

Seluruh token didefinisikan satu kali di `src/app/globals.css`. Setiap pasangan teks dan latar telah diverifikasi lulus WCAG 2.2 AA (`>= 4.5:1` teks normal, `>= 3.0:1` teks besar) di kedua mode tema.

### 2.1 Dark Ops Mode (`:root`, `data-theme="dark"`)

| Token CSS | Hex | Kontras pada `#111317` | Peran Operasional |
|---|---|---|---|
| `--canvas` / `--background` | `#0B0C0E` | - | Kanvas dasar & latar bingkai bukti |
| `--surface-0` | `#0E1014` | - | Bilah navigasi kiri & bilah kepala panel |
| `--surface-1` / `--surface` | `#111317` | - | Bidang utama buku besar (*ledger pane*) |
| `--surface-2` / `--surface-raised` | `#171A20` | - | Kepala tabel *sticky*, baris *hover*, bilah sekunder |
| `--surface-3` | `#1E222A` | - | Item navigasi aktif & kontrol terpilih |
| `--surface-4` | `#242933` | - | Popover konfigurasi endpoint |
| `--border-subtle` | `#1F242D` | - | Garis bagi baris tabel internal |
| `--border` | `#2A303C` | - | Garis pembagi struktural `1px` antar-bidang |
| `--border-strong` | `#3D4556` | - | Garis tepi kontrol input & bingkai aktif |
| `--foreground` | `#EFECE6` | `15.77 : 1` (AAA) | Teks utama, angka metrik, nama host |
| `--muted-strong` | `#C8C5BE` | `10.79 : 1` (AAA) | Teks deskripsi, isi temuan forensik |
| `--muted` | `#98968F` | `6.28 : 1` (AA+) | Label kolom, indeks grup, stempel waktu |
| `--accent` (CTA Primer) | `#EFECE6` | `16.16 : 1` dgn `#0E1013` | Tombol aksi primer monokrom kontras tinggi |
| `--on-accent` | `#0E1013` | `16.16 : 1` | Teks/ikon di atas tombol primer |
| `--accent-ink` (Signal Teal) | `#4FD1C5` | `9.97 : 1` (AAA) | Fokus `:focus-visible`, garis bidik diff, indikator tahap |
| `--verdict-critical` | `#FF6B6B` | `6.70 : 1` (AA+) | Status `PHISHING KRITIS` (+ ikon `OctagonAlert`) |
| `--verdict-suspicious` | `#F6AD3C` | `9.71 : 1` (AAA) | Status `MENCURIGAKAN` (+ ikon `AlertTriangle`) |
| `--verdict-safe` | `#4ADE80` | `10.67 : 1` (AAA) | Status `AMAN` (+ ikon `ShieldCheck`) |

### 2.2 Projector Light Mode (`:root[data-theme="light"]`)

| Token CSS | Hex | Kontras pada `#FFFFFF` | Peran Operasional |
|---|---|---|---|
| `--canvas` / `--background` | `#F5F4F0` | - | Kanvas kertas batu hangat |
| `--surface-0` | `#EFECE6` | - | Bilah navigasi kiri & kepala panel |
| `--surface-1` / `--surface` | `#FFFFFF` | - | Bidang utama buku besar & tabel |
| `--surface-2` / `--surface-raised` | `#ECEAE4` | - | Kepala tabel *sticky*, baris *hover*, bilah pemberitahuan |
| `--surface-3` | `#E3E0D8` | - | Item navigasi aktif & kontrol terpilih |
| `--surface-4` | `#FFFFFF` | - | Popover konfigurasi endpoint |
| `--border-subtle` | `#E2DFD7` | - | Garis bagi baris tabel internal |
| `--border` | `#CFCBC0` | - | Garis pembagi struktural `1px` antar-bidang |
| `--border-strong` | `#9E998D` | - | Garis tepi kontrol input & bingkai bukti |
| `--foreground` | `#141619` | `18.13 : 1` (AAA) | Teks utama, angka metrik, nama host |
| `--muted-strong` | `#32363D` | `12.13 : 1` (AAA) | Teks deskripsi, isi temuan forensik |
| `--muted` | `#555B65` | `6.84 : 1` (AA+) | Label kolom, indeks grup, stempel waktu |
| `--accent` (CTA Primer) | `#141619` | `16.76 : 1` dgn `#F7F6F2` | Tombol aksi primer tinta karbon |
| `--on-accent` | `#F7F6F2` | `16.76 : 1` | Teks/ikon di atas tombol primer |
| `--accent-ink` (Signal Teal) | `#0D6E66` | `6.11 : 1` (AA+) | Fokus `:focus-visible`, garis bidik diff, indikator tahap |
| `--verdict-critical` | `#B91C1C` | `6.47 : 1` (AA+) | Status `PHISHING KRITIS` (+ ikon `OctagonAlert`) |
| `--verdict-suspicious` | `#9A5200` | `5.86 : 1` (AA+) | Status `MENCURIGAKAN` (+ ikon `AlertTriangle`) |
| `--verdict-safe` | `#156D3B` | `6.40 : 1` (AA+) | Status `AMAN` (+ ikon `ShieldCheck`) |

### 2.3 Layer Anotasi Bukti Visual (Terkunci ke OpenCV Backend)

- `--layer-logo: #ed1c24` (Crimson)
- `--layer-qr: #d228d2` (Magenta)
- `--layer-form: #ffa500` (Amber)
- `--layer-input: #ef4444` (Red)

## 3. Tipografi & Hierarki Buku Besar

- **Keluarga Font Lokal (`next/font/local`)**: `Geist Sans` untuk antarmuka dan judul; `Geist Mono` untuk seluruh alamat URL/host, nomor tiket, skor risiko, persentase, latensi, dan tag teknis.
- **Disiplin Numerik**: Seluruh angka metrik wajib `font-variant-numeric: tabular-nums`.
- **Skala Ukuran**:
  - `hero-metric`: `Geist Mono`, `44px` (`2.75rem`), `700`, `line-height: 1.0`, `tracking: -0.035em` (angka fokus utama seperti Insiden Kritis Aktif & sel Matriks Konfusi).
  - `ledger-metric`: `Geist Mono`, `24px` (`1.5rem`), `600`, `line-height: 1.1`, `tracking: -0.02em` (sel metrik sebaris).
  - `panel-title` (`h1`): `Geist Sans`, `18px-20px`, `600`, `tracking: -0.02em`.
  - `pane-header` (`h2`/`h3`): `Geist Sans`, `13px`, `600`, `uppercase`, `tracking: 0.05em` atau `15px` `600` kalimat tegas.
  - `table-cell` / `ui`: `13.5px-14px` (`0.84375rem-0.875rem`), `line-height: 1.45`.
  - `body`: `15px-16px`, `line-height: 1.5`, lebar baca dibatasi `<= 68ch`.
  - `tag-mono`: `Geist Mono`, `11.5px-12px`, `600`, `tracking: 0.04em`.

## 4. Arsitektur Ruang Kerja (`1440x900` Desktop, Tablet `768px`, Mobile `390px`)

1. **Kerangka Dek Komando Atas Dua Tingkat (`AppShell.tsx` pada `/`)**:
   - **Nol Bilah Sisi Kiri (Zero Left Sidebar)**: Bilah navigasi vertikal `236px` dihapus sepenuhnya agar seluruh bidang kerja memperoleh lebar penuh `100vw`.
   - **Tingkat 1 (Top Command Deck)**: Identitas sistem + node operasi `PUSSIBERAD // NODE-SOC-01` + telemetri mesin/basis data sebaris (`HealthStrip`) + sakelar tema instan (`ThemeToggle`: `Mode Gelap` / `Mode Proyektor`).
   - **Tingkat 2 (Horizontal 6-Module Matrix Bar)**: Enam sel modul bernomor (`MOD-01` s.d. `MOD-06`) berbatas garis `1px` (`divide-x`) yang dapat diakses satu klik tanpa muat ulang halaman.
   - Di layar `>= 1024px`: tinggi ruang kerja dikunci `100svh` dengan scroll terisolasi per lajur (`.vk-scroll`).
2. **Enam Bidang Operasional Berstruktur Khusus**:
   - **MOD-01 Inventaris & Triase (`?view=komando`)**: Pita telemetri kompak + **Omnibar Eksekusi Sandbox Sebaris** + **Master-Detail Split**: Tabel Inventaris Multi-Poros (`V / D / M`) di kiri (`7 kolom`) dan **Laci Inspektur Forensik Di-Tempat & Telemetri Satuan** di kanan (`5 kolom`).
   - **MOD-02 Sandbox & QR (`?view=pemindaian`)**: Dek perintah terminal dua mode (`[01] URL Chromium` | `[02] Poster QR/OCR`) di atas **Matriks 3-Kolom (`4 | 4 | 4`)**: Katalog Target Simulasi Terisolasi (Kolom 01), Tabel Diagnostik 6-Bendera Domain (`FLG-01..06`) & Dropzone Citra (Kolom 02), serta Jejak Pipeline 5-Tahap Vertikal (Kolom 03).
   - **MOD-03 IDE Forensik (`?view=forensik&insiden=<id>`)**: **Meja Kerja IDE 3-Lajur Tanpa Gulir Halaman (`15rem | minmax(0,1fr) | 21.5rem`)**: Antrean Tiket Insiden 1-Klik di lajur kiri, Panggung Bukti Visual/Diff di tengah atas + **Dok Telemetri Bertab Ala DevTools** (`DOM & Form`, `QR & OCR`, `Redirect HTTP`, `Waterfall SLA`) di tengah bawah, serta Rincian Skor Deterministik & Temuan Kunci di lajur kanan.
   - **MOD-04 Kompiler Blokir (`?view=mitigasi&host=<host>`)**: **Pita Horizontal 9-Format Infrastruktur (`FMT-01..09`)** di bagian atas + belahan **Tabel Indikator IOC Tervalidasi RFC (6 kolom)** di kiri dan **Penampil Kode Aturan Terminal Penuh Bernomor Baris (`001..N`, 6 kolom)** di kanan.
   - **MOD-05 Jembatan WA (`?view=lapor-cepat`)**: **Jembatan Triase Lapangan 3-Kolom (`3 | 5 | 4`)**: Dek Skenario & Dropzone Lampiran Prajurit di Kolom 01, Terminal Pesan Lapangan (`--wa-*`) di Kolom 02, dan Jejak Eksekusi Pipeline SOC 4-Tahap + Tiket Hasil Terakhir di Kolom 03.
   - **MOD-06 Matriks Evaluasi (`?view=audit`)**: Belahan **Buku Besar Verifikasi Ambang Teknis (`MET-01..05`) & Tabel Distribusi Latensi SLA (4 kolom)** di kiri, dipasangkan dengan **Tabel Matriks Kebingungan Silang 2x2 (`Aktual \ Prediksi`) & Tabel Studi Ablasi Detektor (8 kolom)** di kanan.

## 5. Aturan Interaksi, Keyboard & Cetak

- **Fokus Keyboard (`R-32`)**: Seluruh elemen interaktif menggunakan `:focus-visible` dengan `outline: 2px solid var(--accent-ink)` dan `outline-offset: 2px`, didukung penuh pada High Contrast / Forced Colors Mode, dilengkapi tautan *Skip to main content* di awal dokumen.
- **Gerak Minimal (`MOTION=2`)**: Hanya transisi warna permukaan/garis `120ms ease-out` dan umpan balik tekan tombol halus. Nol animasi gulir, nol *bounce*, dan patuh penuh terhadap `prefers-reduced-motion: reduce`.
- **Mode Cetak (`@media print`)**: Menyembunyikan bilah sisi dan kontrol kerja (`.vk-no-print`), mencetak kop resmi laporan forensik di atas kertas putih `#FFFFFF`.
