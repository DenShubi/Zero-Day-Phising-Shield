---
version: "3.0"
name: VisiKartika-Shield-Soft-Console
archetype: Soft Console (floating app window, product-dashboard density)
dial: "ENERGY=3, RHYTHM=5, MOTION=2"
pageType: software
siteKind: software
colorScheme: "light dark (Soft Light default + Deep Dark)"
---

# DESIGN.md: VisiKartika Shield - Soft Console

Dial: `ENERGY=3, RHYTHM=5, MOTION=2`

Dokumen ini mengunci sistem desain generasi ke-3 untuk `frontend-soc/`. Versi ini
mengganti **Architectural Security Ledger** (v2.0) secara menyeluruh.

Referensi visualnya adalah dasbor produk modern (Sypher, Fulcrum, dan sejenisnya):
satu jendela aplikasi melayang di atas kanvas bernuansa, sudut membulat, banyak
ruang kosong, dan tipografi tenang. **Situs institusi/pemerintah tidak dipakai
sebagai acuan tampilan.** Konten domainnya tetap: yang berubah hanya bahasa rupa.

## 1. Prinsip

1. **Satu Jendela Aplikasi, Bukan Mozaik Kartu.** Seluruh konsol hidup di dalam
   satu bingkai `.vk-app-window` (radius `18px`, 1px border, `--shadow-window`)
   yang melayang di atas kanvas `--canvas`. Di dalamnya, bidang dipisah oleh
   garis rambut 1px dan perbedaan permukaan - bukan oleh tumpukan kartu
   mengambang.
2. **Geometri Lembut.** Skala radius tunggal: `--r-xs 6` / `--r-sm 8` /
   `--r-md 10` / `--r-lg 14` / `--r-xl 18` / `--r-pill`. Tag status dan chip
   filter memakai bentuk kapsul (`--r-pill`); tidak ada lagi sudut tajam
   `0px-4px`.
3. **Elemen Dulu, Teks Belakangan.** Setiap panel tidak lagi punya `<h1>` +
   kalimat penjelas: tab navigasi yang aktif sudah menamai panelnya, dan pita
   metrik, kepala tabel, serta inspektur menamai dirinya sendiri. `<h1>` tetap
   ada tetapi `visually-hidden` untuk pembaca layar dan target *skip link*.
   Angka tidak diulang sebagai kalimat; ikon tidak diulang sebagai label.
4. **Warna Hanya Saat Berarti.** Permukaan dan tinta netral; satu aksen merek
   indigo (`--accent`) untuk aksi primer, tab aktif, dan cincin fokus. Merah /
   amber / hijau **eksklusif** milik skala verdict, selalu berpasangan dengan
   ikon dan label teks sehingga tetap terbaca tanpa warna.
5. **Logo Masih Placeholder.** `src/components/ui/BrandMark.tsx` sengaja
   menampilkan ubin bergaris putus-putus. Ganti isi berkas itu saja saat logo
   asli siap; tidak ada tempat lain yang perlu disentuh.
6. **Dua Tema Setara.** Soft Light adalah bawaan (`data-theme="light"`), Deep
   Dark sepenuhnya selesai, bukan turunan. Pergantian instan tanpa FOUC (skrip
   sinkron + `<meta name="color-scheme">`).

## 2. Token Warna

Semua token hidup satu kali di `src/app/globals.css`. `--surface-0` adalah pita
tenang di belakang kepala panel, rel samping, dan kolom pendamping;
`--surface-1` adalah bidang baca utama. Perbedaan keduanya yang memberi struktur
setelah garis tebal ledger dihapus.

### 2.1 Soft Light (bawaan, `:root`)

| Token | Hex | Peran |
|---|---|---|
| `--canvas` | `#eceef2` | Kanvas di luar jendela aplikasi |
| `--surface-0` / `--surface-2` | `#f7f8fa` | Pita kepala, rel samping, baris *hover* |
| `--surface-1` | `#ffffff` | Bidang baca utama, tabel, kartu |
| `--surface-3` | `#eef0f4` | Trek navigasi, avatar baris, isian terpilih |
| `--border-subtle` | `#f0f1f4` | Garis antar-baris tabel |
| `--border` | `#e5e7ec` | Garis pembagi struktural + tepi kontrol |
| `--border-strong` | `#d2d5dd` | Tepi *hover* kontrol, bingkai dropzone |
| `--foreground` | `#16171c` | Teks utama (17.4:1 di `#ffffff`) |
| `--muted-strong` | `#434652` | Teks isi sekunder (10.8:1) |
| `--muted` | `#71747f` | Label kolom, stempel waktu (5.3:1) |
| `--accent` | `#5b59d6` | Aksi primer; teks putih di atasnya 5.5:1 |
| `--accent-ink` | `#4f4dcb` | Aksen sebagai teks (6.4:1) |
| `--verdict-critical` | `#c02626` | `PHISHING` (+ ikon `OctagonAlert`) |
| `--verdict-suspicious` | `#92540a` | `MENCURIGAKAN` (+ ikon `AlertTriangle`) |
| `--verdict-safe` | `#157a47` | `AMAN` (+ ikon `ShieldCheck`) |

### 2.2 Deep Dark (`:root[data-theme="dark"]`)

| Token | Hex | Peran |
|---|---|---|
| `--canvas` | `#0f1012` | Kanvas di luar jendela |
| `--surface-0` | `#1f2024` | Pita kepala dan rel samping |
| `--surface-1` | `#1a1b1f` | Bidang baca utama |
| `--surface-3` | `#292a30` | Trek navigasi, isian terpilih |
| `--border` | `#2d2e35` | Garis pembagi struktural |
| `--foreground` | `#f1f1f4` | Teks utama (15.4:1 di `#1a1b1f`) |
| `--muted-strong` | `#c2c3cb` | Teks isi sekunder (9.2:1) |
| `--muted` | `#8c8e99` | Label kolom (5.2:1) |
| `--accent` | `#8886f5` | Aksi primer; tinta gelap di atasnya 6.0:1 |
| `--accent-ink` | `#a5a3ff` | Aksen sebagai teks (7.7:1) |
| `--verdict-critical` | `#ff7a7a` | `PHISHING` |
| `--verdict-suspicious` | `#f7b955` | `MENCURIGAKAN` |
| `--verdict-safe` | `#4ade80` | `AMAN` |

### 2.3 Verdict sebagai Isian Grafik (`--chart-*`)

Token `--verdict-*` adalah **tinta**: dipakai untuk teks dan ikon, jadi
dikalibrasi ke 4.5:1. Sebagai **isian batang** syaratnya cuma 3:1, dan selisih
itu yang dipakai untuk memisahkan amber dari merah. Sebagai tinta, pasangan
amber-merah mode terang hanya berjarak OKLab dE 11.9 (penglihatan normal), di
bawah ambang 15 - pembaca dengan deuteranopia tidak bisa membedakannya sama
sekali. Karena itu grafik memakai set terpisah, divalidasi sebagai satu
kesatuan dalam urutan tumpukan `[aman, mencurigakan, phishing]`: pita
kecerahan, lantai chroma, pemisahan CVD, lantai penglihatan normal, dan kontras
terhadap permukaan - semuanya lulus di kedua mode.

| Token | Terang | Gelap |
|---|---|---|
| `--chart-safe` | `#157a47` | `#127946` |
| `--chart-suspicious` | `#d97706` | `#c38824` |
| `--chart-critical` | `#c02626` | `#c82d40` |

Nilai gelap **dipilih ulang, bukan dibalik**: token tinta gelap duduk di OKLab
L 0.74-0.84, jauh di atas pita 0.48-0.67 yang pantas untuk sebuah tanda di atas
permukaan gelap.

### 2.4 Layer Anotasi Bukti (terkunci ke warna PNG dari backend OpenCV)

`--layer-logo: #ed1c24` &middot; `--layer-qr: #d228d2` &middot;
`--layer-form: #ffa500` &middot; `--layer-input: #ef4444`

## 3. Tipografi

- `Geist Sans` (`next/font/local`) untuk seluruh antarmuka.
- `Geist Mono` **hanya** untuk alamat URL/host, blok aturan blokir, dan nomor
  tiket - bukan untuk label kolom atau tag status. Label kolom kini kalimat
  biasa 12px/500, bukan monospace kapital berspasi.
- Angka memakai `font-variant-numeric: tabular-nums` (`.vk-tabular`).
- Skala: `.vk-metric-lg` 40px/650, `.vk-metric` 28px/600,
  `.vk-section-title` 15px/600, isi 13-13.5px, label 12px/500.

## 4. Arsitektur Ruang Kerja

### 4.1 Kerangka

```
canvas (padding 12-16px)
└── .vk-app-window                       radius 18px, overflow hidden
    ├── .vk-topbar                       logo placeholder | 4 tab | status + tema
    ├── .vk-page-header  (opsional)      kontrol khusus panel, bukan judul
    └── main                             panel aktif
```

`.vk-topbar` membungkus di bawah `768px`: identitas + status di baris pertama,
trek navigasi mendapat barisnya sendiri yang dapat digeser.

### 4.2 Empat Panel (sebelumnya enam)

Enam tab lama membuat beberapa panel terasa kosong. Pekerjaan yang satu nafas
kini satu tab:

| Tab | `?view=` | Isi | Menyerap |
|---|---|---|---|
| **Beranda** | `beranda` (bawaan) | Omnibar pindai + pita verdict + tabel riwayat (7 kol) + inspektur (5 kol) | `komando` + `pemindaian` |
| **Bukti** | `forensik` | Panggung bukti visual / diff + dok telemetri bertab + rincian skor | `forensik` |
| **Respons** | `respons` | *Segmented control*: `Daftar Blokir` \| `Lapor WhatsApp` | `mitigasi` + `lapor-cepat` |
| **Akurasi** | `evaluasi` | Metrik, confusion matrix, latensi, ablasi | `audit` |

Seluruh id lama tetap jadi alias di `src/lib/panel-route.ts`, jadi tautan lama
tidak mati; `?view=lapor-cepat` mendarat langsung di paruh WhatsApp, dan
`?view=mitigasi&host=...` di paruh daftar blokir.

### 4.3 Beranda

1. **Omnibar** (`ScanOmnibar`): satu baris - kolom URL, tombol `Gambar` yang
   membuka dropzone sebaris, tombol `Pindai`. Di bawahnya chip contoh uji satu
   klik dan kolom satuan pelapor opsional. Pratinjau reputasi domain muncul
   sendiri saat URL diketik; progres lima tahap muncul saat pemindaian jalan.
2. **Pita Verdict + Tren** (`5 | 7` kolom): di kiri empat sel metrik
   (`Dipindai`, `Phishing`, `Mencurigakan`, `Aman`) dalam kisi `2x2` - sel total
   memakai batang bertumpuk yang menunjukkan komposisi, sel lain batang porsi +
   persentase. Di kanan `VerdictTrend`, grafik batang bertumpuk 14 hari.
   Keduanya membaca angka yang sama, jadi tidak ada kalimat yang mengulangnya.
3. **Tabel + Inspektur**: tabel riwayat (avatar inisial, target, status, skor,
   usia) di kiri; ringkasan baris terpilih (verdict, tiket, target, tangkapan
   layar, skor, temuan) di kanan.

## 5. Grafik (`VerdictTrend`)

Satu grafik di seluruh konsol, di Beranda: **batang bertumpuk per hari**, karena
tugas datanya adalah "lihat komposisi berubah sepanjang waktu".

- **Tanda**: batang dibatasi `22px`, radius `4px` hanya di ujung data (atas),
  siku di garis dasar, jarak `2px` berwarna permukaan antar-segmen tumpukan.
  Garis bantu `1px` solid, resesif. Tinggi bidang plot `136px`.
- **Identitas tidak pernah bergantung warna saja**: verdict adalah palet status,
  jadi legenda membawa ikon + nama tiap verdict, kartu hover menyebut ketiganya
  dengan angkanya, dan di bawahnya ada **tabel `visually-hidden`** berisi seluruh
  angka per hari. Tooltip memperkaya, tidak pernah menjadi satu-satunya jalan.
- **Label hemat**: tidak ada angka di atas tiap batang. Sumbu Y memberi
  `0 / tengah / maks` (dibulatkan ke 1/2/2.5/5 x 10^n), sumbu X hanya hari
  pertama, tengah, dan terakhir.
- **Jendela dijangkarkan ke pemindaian terbaru, bukan ke `Date.now()`** -
  render harus murni, dan kepala grafik mencetak rentang tanggal yang benar-benar
  dicakup, jadi masa sepi tampak sebagai tanggal lama di sumbu alih-alih jendela
  yang diam-diam berbohong.
- Keadaan kosong menggambar garis bantu saja, tanpa tanggal, sehingga render
  server dan klien identik.

## 6. Komponen Bersama

| Kelas | Bentuk |
|---|---|
| `.vk-btn` + `-primary` / `-secondary` / `-ghost` | radius `10px`, bayangan halus |
| `.vk-input` | radius `10px`, cincin fokus `3px` aksen. Padding-nya ada di `@layer components` agar utilitas Tailwind (`pl-9` untuk ikon di dalam kolom) tetap menang |
| `.vk-chip` | kapsul filter; aktif = tinta penuh (`aria-pressed` / `data-active`) |
| `.vk-pill` | tag status kapsul (verdict) |
| `.vk-nav-track` + `.vk-nav-tab` | *segmented control*; aktif = permukaan terangkat (`aria-current="page"`) |
| `.vk-card` / `.vk-card-quiet` | blok lunak radius `14px` |

## 7. Interaksi, Keyboard, Cetak

- **Fokus**: `:focus-visible` dengan `outline: 2px solid var(--accent)` +
  `outline-offset: 2px`, didukung `forced-colors`, plus *skip link*.
- **Gerak (`MOTION=2`)**: hanya transisi warna/bayangan `130ms`, patuh penuh
  pada `prefers-reduced-motion`.
- **Hidrasi**: usia relatif dan blok aturan blokir dihitung dari jam masing-
  masing sisi, jadi keduanya memakai `suppressHydrationWarning` alih-alih
  menahan render sampai *mount* - tidak ada lagi kedipan "-" di kolom waktu.
- **Cetak**: `.vk-no-print` disembunyikan, jendela diratakan ke kertas putih,
  URL dibentangkan di belakang tautan.
