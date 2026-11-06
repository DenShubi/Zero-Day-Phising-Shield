# Prompt untuk Gemini / Antigravity — Redesign UI VisiKartika Shield

Copy semua yang ada di dalam blok di bawah ini ke Antigravity.

---

```
Kerjakan redesign total lapisan presentasi aplikasi di folder `frontend-soc`.

## Skill yang WAJIB kamu pakai, dalam urutan ini

1. Muat skill `design-taste-frontend` dulu dan patuhi house rules-nya sebagai aturan
   tertinggi (anti-slop, 1 section per screen di 1440x900, real UI bukan placeholder
   generik, tanpa caption di bawah gambar).
2. Jalankan `brand-design-md` dan terapkan DESIGN.md **Linear** ke root workspace
   `frontend-soc/` sebagai sistem dasar: type scale, spacing, radius, elevation,
   motion, dan disiplin warnanya. Jangan pakai logo/warna brand Linear — hanya
   sistem desainnya.
3. Muat skill style `bento` dari `design-style-catalog` dan pakai untuk komposisi
   grid di dalam tiap layar. Kalau kamu butuh style pendukung, `minimal` boleh;
   jangan pakai glassmorphism, neobrutalism, retro, atau neon.
4. Setelah selesai implementasi, jalankan checker visual/konsistensi
   `scripts/consistency.mjs` dari taste-skill terhadap dev server, perbaiki semua
   temuannya, lalu jalankan ulang sampai bersih. Laporkan output akhirnya.

## Apa aplikasi ini

SOC command console untuk deteksi phishing bertema institusi militer Indonesia.
Operator memasukkan URL atau screenshot/poster, backend memindai (visual similarity,
anomali DOM, telemetri domain, OCR, deteksi QR/quishing), lalu mengeluarkan verdict
`SAFE` / `SUSPICIOUS` / `CRITICAL_PHISHING` dengan skor 0–100, bukti visual
ber-bounding-box, dan ekspor blocklist DNS. Ada juga simulator pelaporan WhatsApp.
Ini dipresentasikan ke juri lomba lewat proyektor, jadi legibility dari jarak jauh
dan alur demo yang mulus itu kriteria desain, bukan nice-to-have.

## Masalah dengan desain sekarang — ini yang harus hilang

- Membosankan dan tidak punya hierarki. Semua panel punya berat visual yang sama:
  `rounded-lg border bg-surface p-4`, heading `text-sm font-semibold`, diulang
  belasan kali. Tidak ada focal point di layar mana pun.
- Grid kartu seragam yang mati. Lima tile KPI identik berjejer, lalu dua section
  kotak, lalu feed. Mata tidak tahu harus ke mana.
- Tidak efisien. Enam route terpisah memaksa reload dan kehilangan konteks; hasil
  scan tidak nyambung ke forensiknya tanpa pindah halaman.
- Chrome institusional yang jelek: kotak "VK" dan label unit di header, warna hijau
  institusi yang dipakai sebagai aksen tanpa pertimbangan, header navigasi berupa
  baris pill yang generik.
- Tipografi flat: hampir semua teks di rentang 12–16px, tidak ada display size,
  tidak ada tracking yang diatur, angka penting tidak dominan.

## Target arsitektur: SATU halaman + sidebar

Gabungkan keenam route (`/`, `/sandbox`, `/forensics`, `/audit`, `/mitigasi`,
`/whatsapp`) menjadi **satu route** `/` dengan sidebar kiri permanen yang mengganti
panel secara client-side. Tanpa full page reload saat pindah panel.

- Sidebar permanen, lebar tetap (sekitar 240–260px), collapsible ke rail ikon.
  Isinya dikelompokkan, bukan daftar datar:
  - **Operasi**: Pusat Komando, Konsol Pemindaian
  - **Analisis**: Forensik, Audit Akurasi
  - **Tindakan**: Mitigasi, Simulasi Lapor Cepat
  Status engine/database (komponen `HealthStrip` yang ada) pindah ke bagian bawah
  sidebar sebagai footer status, bukan di pojok kanan atas header.
- State panel aktif harus bisa di-deep-link lewat query param (mis. `/?view=forensik`
  dan `/?view=forensik&insiden=<id>`) supaya demo bisa dibuka langsung ke satu layar
  dan tombol back peramban tetap masuk akal. Pakai `useSearchParams` +
  `router.replace`, jangan state lokal saja.
- Alur harus nyambung: setelah scan selesai di Konsol Pemindaian, hasilnya bisa
  dibuka di panel Forensik tanpa meninggalkan halaman, dan indikator kritis bisa
  langsung masuk ke panel Mitigasi.
- Tiap panel muat dalam satu layar 1440x900 tanpa scroll vertikal pada kerangkanya.
  Kalau isinya memang panjang (tabel audit, feed insiden, konsol log), yang scroll
  adalah region internalnya sendiri, bukan halaman.

## Identitas visual: netral, identitas produk sendiri

Buang identitas institusional dari UI. Jangan jadikan tampilan Pussiberad / portal
pemerintah sebagai referensi — justru itu yang mau dihindari.

- Buat identitas produk sendiri untuk "VisiKartika Shield": satu mark SVG custom yang
  bersih (inline SVG, bukan emoji, bukan kotak berisi inisial), satu warna aksen
  utama yang modern dan dipakai hemat, dan wordmark dengan tracking yang diatur.
- Nama unit (`PUSSIBERAD TNI AD`) hanya boleh tampil sebagai metadata kecil di footer
  sidebar atau di header laporan cetak. Jangan di navigasi utama.
- Hijau institusi `#1f7a4d` TIDAK wajib dipertahankan sebagai aksen. Pilih aksen yang
  benar-benar bekerja di atas dark surface dan tidak bertabrakan dengan skala verdict.

## Aturan keras — melanggar ini berarti pekerjaan gagal

1. **Ini pekerjaan presentasi saja.** Jangan ubah logika, kontrak data, atau
   pemanggilan API. JANGAN sentuh: folder `app/` di root repo (itu backend Python),
   `frontend-soc/src/lib/**` (kecuali menambah helper baru untuk routing panel),
   `frontend-soc/src/fixtures/**`, dan signature props komponen yang sudah ada kalau
   tidak perlu. Semua perilaku yang sekarang jalan harus tetap jalan.
2. **Token verdict tetap satu sumber.** `--verdict-safe`, `--verdict-suspicious`,
   `--verdict-critical` dan token layer anotasi (`--layer-logo`, `--layer-qr`,
   `--layer-form`, `--layer-input`) didefinisikan sekali di
   `src/app/globals.css` dan dikonsumsi oleh badge, score bar, chart, marker peta,
   dan stroke bounding box. Nilainya boleh kamu retune, tapi definisinya tetap satu
   tempat dan tidak boleh ada warna verdict yang di-hardcode di komponen. Token layer
   anotasi harus tetap cocok dengan warna yang dibakar backend ke PNG bukti
   (crimson/magenta/amber/red) — jangan diubah semaunya.
3. **Warna tidak boleh jadi satu-satunya pembawa makna.** Setiap verdict dan setiap
   status selalu punya ikon + label teks. Ini syarat aksesibilitas yang sudah ada,
   pertahankan.
4. **Semua copy berbahasa Indonesia dan hanya dari `src/lib/i18n/id.ts`.** Jangan
   tulis string Indonesia langsung di JSX. Kalau butuh label baru, tambahkan entry
   ke tabel itu dengan terminologi yang konsisten dengan yang sudah ada.
5. **Jalur cetak harus tetap hidup.** Ada `@media print` di `globals.css` dan kelas
   `.vk-no-print`; Forensik punya aksi "Cetak Laporan" yang menghasilkan laporan
   insiden. Setelah redesign, cetak masih harus menghasilkan dokumen latar putih yang
   terbaca, dan sidebar tidak ikut tercetak.
6. **Font tidak boleh di-fetch saat build.** Saat ini sengaja pakai system font stack
   karena host build bisa ada di jaringan terfilter dan demo harus bisa offline.
   Kalau kamu mau Inter atau Geist, self-host lewat `next/font/local` dengan file
   woff2 di `public/`. Jangan pakai `next/font/google` dan jangan `@import` dari
   Google Fonts.
7. **Stack tetap.** Next.js 16 App Router, React 19, Tailwind CSS v4 (konfigurasi
   lewat `@theme inline` di CSS, bukan `tailwind.config.js`), TypeScript strict.
   Jangan tambah dependensi UI baru — tanpa shadcn/ui, tanpa MUI, tanpa Chakra,
   tanpa framer-motion. Chart dan visualisasi dibuat dengan SVG/CSS buatan sendiri
   seperti komponen yang sudah ada. Ikon dibuat sebagai inline SVG di satu modul
   `src/components/ui/icons.tsx`.
8. `npm run typecheck`, `npm run lint`, dan `npm run test` harus lulus setelah
   pekerjaanmu. `npm run build` harus sukses.

## Arahan hierarki yang spesifik

Perlakukan ini sebagai brief tiap panel, bukan saran.

- **Pusat Komando** — satu angka dominan sebagai focal point: jumlah insiden kritis
  aktif, ukuran display (60px+, tabular-nums, tracking rapat). Metrik lain jadi satelit
  yang jelas lebih kecil. Feed insiden hidup di kolom kanan dengan indikator realtime
  yang halus (bukan badge "LIVE" yang berkedip norak). Distribusi verdict jadi satu
  bar bertumpuk yang terbaca sekali lihat, bukan tiga baris progress bar terpisah.
  Area sebaran asal laporan sekarang masih placeholder dua kotak angka — ganti jadi
  visualisasi yang jujur dan padat (mis. ranking satuan pelapor dengan bar), dan tetap
  tampilkan jumlah "Asal tidak terpeta" karena itu mayoritas kasus dari kanal WhatsApp.
- **Konsol Pemindaian** — input URL adalah elemen paling dominan di layar: field besar,
  satu aksi primer. Dropzone gambar jadi affordance sekunder di dekatnya, bukan kotak
  sebesar yang sama. Progress pemindaian berupa stepper horizontal yang bisa dibaca
  dari jarak 5 meter. Target uji cepat untuk juri jadi deretan chip yang jelas opsional.
- **Forensik** — bukti visual mendominasi, minimal 60% lebar layar. Overlay bounding
  box interaktif dengan legend layer yang bisa di-toggle (sudah ada di
  `BBoxOverlay`/`.vk-overlay`) tetap jadi pusat perhatian. Panel skor, telemetri DOM,
  temuan, dan latensi jadi rail samping yang padat dan bisa di-collapse. Komparasi
  side-by-side dengan portal resmi harus terasa seperti diff, bukan dua gambar
  bersebelahan tanpa makna.
- **Audit Akurasi** — confusion matrix jadi hero: grid yang rapi, angka besar, warna
  diagonal yang bermakna. Tabel baseline di bawahnya dengan tipografi tabular yang
  benar dan header sticky.
- **Mitigasi** — tabel indikator dengan checkbox dan satu aksi unduh yang jelas per
  format. Peringatan simulasi tampil sebagai callout yang tidak bisa diabaikan tapi
  juga tidak berisik.
- **Simulasi Lapor Cepat** — chat WhatsApp yang terasa autentik di satu sisi, dan
  panel yang menjelaskan apa yang terjadi di pipeline di sisi lain, sehingga penonton
  paham hubungan sebab-akibatnya.

## Yang harus kamu lakukan sebelum menulis kode

1. Baca dulu: `frontend-soc/src/app/globals.css`, `src/app/layout.tsx`,
   `src/components/shell/AppShell.tsx`, `src/app/page.tsx`, keenam page,
   `src/lib/i18n/id.ts`, dan `src/lib/verdict.ts`, supaya kamu tahu komponen dan token
   apa yang sudah ada dan bisa dipakai ulang. Perhatikan komentar di atas
   `globals.css` — itu menjelaskan kenapa token verdict terpusat.
2. Baca `frontend-soc/AGENTS.md`. Next.js versi ini punya breaking changes dari yang
   mungkin kamu hafal; baca guide relevan di `node_modules/next/dist/docs/` sebelum
   menulis kode App Router.
3. Jalankan `npm run dev` dan lihat keadaan sekarang di 1440x900 sebelum mengubah apa
   pun, supaya kritikmu berdasar.
4. Setelah itu, tulis `DESIGN.md` di `frontend-soc/` yang mengunci keputusan sistem
   (palette final dengan nilai hex, type scale, spacing scale, radius, elevation,
   aturan motion, dan daftar komponen) dan tunjukkan ke saya. Baru setelah itu
   implementasi.

## Definisi selesai

- Satu route `/` dengan sidebar permanen, enam panel, deep-link lewat query param.
- `DESIGN.md` ada dan implementasinya benar-benar mengikutinya.
- `scripts/consistency.mjs` bersih.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` semua lulus.
- Semua fungsi lama masih bekerja: scan URL, scan gambar, feed realtime Supabase,
  overlay bbox, ekspor blocklist, simulator WhatsApp, cetak laporan.
- Tidak ada dependensi baru di `package.json` selain file font lokal.
```

---

## Catatan untukmu (jangan ikut di-copy)

- Prompt ini sengaja mengunci hal-hal yang biasanya dirusak agen saat redesign:
  token verdict yang tersentralisasi, warna layer anotasi yang harus cocok dengan PNG
  bukti dari backend, jalur cetak, dan larangan `next/font/google`.
- Kalau Antigravity mulai menambah dependensi atau menulis string Indonesia langsung
  di JSX, hentikan dan tunjuk ke aturan keras nomor 4 dan 7.
- Langkah "tulis DESIGN.md dulu, tunjukkan, baru implementasi" itu gerbang penting —
  kalau sistemnya salah di situ, semua layarnya akan ikut salah.
- Kalau hasilnya masih terasa datar, keluhan yang paling efektif adalah menyebut
  komponen spesifik: "panel X dan Y punya berat visual identik, tentukan mana yang
  dominan" lebih berguna daripada "bikin lebih bagus".
