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

1. **Kerangka Satu Halaman (`/`)**:
   - Navigasi sisi kiri rata (`236px` terbuka, `56px` ciut) dengan pengelompokan indeks bernomor (`01 / OPERASI`, `02 / ANALISIS`, `03 / TINDAKAN`), sakelar tema (`Gelap` / `Terang`), dan telemetri status mesin/basis data di bagian bawah.
   - Di layar `>= 1024px`: tinggi terkunci `100svh` dengan scroll terisolasi per lajur (`.vk-scroll`) sehingga bilah kepala dan strip metrik tidak pernah hilang saat menggulir tabel panjang.
   - Di layar `< 1024px`: bilah atas kompak dengan tombol sakelar tema langsung + laci navigasi penuh dan tabel adaptif tanpa pemotongan horizontal.
2. **Enam Bidang Operasional**:
   - **Inventaris Komando (`?view=komando`)**: Strip metrik sebaris berbatas `divide-x` di atas; bagian utama terbelah menjadi **Tabel Inventaris Insiden & Endpoint (8 kolom)** lengkap dengan pencarian instan + filter status, serta **Lajur Distribusi & Satuan Pelapor (4 kolom)** di kanan.
   - **Konsol Pemindaian (`?view=pemindaian`)**: Bilah perintah URL *monospace* ber-kontras tinggi + tabel telemetri domain instan + lajur belah inspeksi gambar QR/OCR & parameter satuan + stepper 5 tahap rata di bagian bawah.
   - **Forensik Artefak (`?view=forensik&insiden=<id>`)**: Bilah alat forensik rata di atas + panggung utama terbelah menjadi **Kanvas Bukti Visual & Diff Portal (`>= 64%`)** di kiri dan **Lajur Inspektur Skor, Temuan, & Latensi (`23rem`, dapat diciutkan)** di kanan.
   - **Audit Akurasi (`?view=audit`)**: Strip 5 KPI evaluasi terukur di atas + panggung belah **Matriks Konfusi 2x2 berbingkai garis `1px` (5 kolom)** dan **Tabel SLA Latensi & Studi Ablasi ber-kepala *sticky* (7 kolom)**.
   - **Mitigasi (`?view=mitigasi&host=<host>`)**: Bilah status simulasi tenang di atas + panggung belah **Tabel Seleksi IOC Host (7 kolom)** dan **Daftar 9 Format Infrastruktur + Pratinjau Kode (5 kolom)**.
   - **Simulasi Lapor Cepat (`?view=lapor-cepat`)**: Panggung belah seimbang antara **Terminal Percakapan Pelapor (6 kolom, adaptif tema)** dan **Jejak Eksekusi Pipeline SOC 4 Tahap (6 kolom)**.

## 5. Aturan Interaksi, Keyboard & Cetak

- **Fokus Keyboard (`R-32`)**: Seluruh elemen interaktif menggunakan `:focus-visible` dengan `outline: 2px solid var(--accent-ink)` dan `outline-offset: 2px`, didukung penuh pada High Contrast / Forced Colors Mode, dilengkapi tautan *Skip to main content* di awal dokumen.
- **Gerak Minimal (`MOTION=2`)**: Hanya transisi warna permukaan/garis `120ms ease-out` dan umpan balik tekan tombol halus. Nol animasi gulir, nol *bounce*, dan patuh penuh terhadap `prefers-reduced-motion: reduce`.
- **Mode Cetak (`@media print`)**: Menyembunyikan bilah sisi dan kontrol kerja (`.vk-no-print`), mencetak kop resmi laporan forensik di atas kertas putih `#FFFFFF`.
