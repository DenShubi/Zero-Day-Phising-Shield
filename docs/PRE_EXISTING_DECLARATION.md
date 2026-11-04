# Deklarasi Komponen Pre-Existing, Pustaka Open-Source, dan Orisinalitas Karya

**Nama Karya:** VisiKartika Shield (Zero-Day-Phising-Shield)  
**Kompetisi:** Kartika Cyber Hackathon 2026 - PUSSIBERAD TNI AD  
**Kategori:** Penangkalan (Defensive Cybersecurity)  
**Tim Pengembang:** Zuan (Backend Sandbox & Computer Vision) dan Denin (SOC Dashboard & WhatsApp Gateway)  
**Periode Pengerjaan:** 31 Oktober 2026 s.d. 15 November 2026  

---

Dokumen ini disusun untuk memenuhi persyaratan transparansi karya pada Bab G (Orisinalitas dan Deklarasi Komponen Pre-Existing) serta Bab N (Etika dan Keamanan Lingkungan Demo) dalam Buku Panduan Kartika Cyber Hackathon 2026.

## 1. Pernyataan Orisinalitas Kode Inti

Kami menyatakan bahwa seluruh kode aplikasi, orkestrasi peramban *headless*, algoritma pencocokan citra dan lambang, perhitungan skor risiko, router pesan WhatsApp, skema basis data, skrip pengujian, serta antarmuka web SOC pada repositori VisiKartika Shield ditulis sendiri dari nol selama periode resmi lomba (31 Oktober s.d. 15 November 2026).

1. Karya ini bukan hasil pengemasan ulang (*rebranding*) dari produk komersial, tugas akhir kuliah, maupun proyek kompetisi sebelumnya.
2. Tidak ada penyalinan kode sumber maupun bobot model terlatih (*pretrained weights*) milik repositori riset pihak ketiga tanpa deklarasi terbuka.
3. Pustaka pihak ketiga yang dipasang melalui `pip`, `npm`, dan `apt` seluruhnya berlisensi *open-source* standar dan berfungsi sebagai kerangka kerja dasar (server API, penggerak peramban, operasi matriks citra, dan klien basis data).

---

## 2. Rincian Modul Orisinal yang Ditulis Tim Selama Lomba

Tabel berikut merinci pembagian modul perangkat lunak yang dirancang dan ditulis mandiri oleh anggota tim selama masa kompetisi.

| Modul | Lokasi Berkas | Penulis | Cakupan Implementasi Orisinal |
| :--- | :--- | :--- | :--- |
| Headless Chromium Sandbox & Anti-SSRF | `app/sandbox/browser.py`, `app/sandbox/annotator.py` | Zuan | Pengelolaan kolam peramban `_WarmPlaywrightPool`, ekstraksi elemen `<form>`/`<input>`, deteksi pengiriman kredensial via AJAX tanpa tag `<form>`, pemutusan 11 pola SSRF (`169.254.169.254`, `file://`, RFC1918), pembatasan memori V8, dan penggambaran kotak bukti pada tangkapan layar. |
| Pencocokan Tata Letak SSIM Pra-Komputasi | `app/vision/similarity.py` | Zuan | Perhitungan *Structural Similarity Index* berbasis statistik Gaussian `float32` (`320x180`) yang dipra-komputasi di RAM sehingga pembandingan terhadap 37 beranda portal resmi selesai rata-rata dalam 46,3 ms. |
| Detektor Piramida 41 Lambang Instansi | `app/vision/logo_detector.py` | Zuan | Pencarian lambang dua tahap: penyaringan kasar pada skala `0.35x` diikuti pencocokan presisi ber-masker alfa (`cv2.TM_CCOEFF_NORMED`) dengan estimasi warna latar lokal terhadap 41 lambang pertahanan dan siber RI. |
| Analisis Poster, QR Quishing, & OCR | `app/vision/image_analyzer.py`, `app/vision/ocr_quishing.py` | Zuan | Klasifikasi geometri gambar (`POSTER_FLYER`, `MOBILE_SCREENSHOT`, `WEB_SCREENSHOT`), deteksi kotak input berbasis kontur OpenCV, dekoder QR berlapis (OpenCV + `PyZbar`), proses *worker* OCR (`Windows.Media.Ocr`, `Tesseract`, dan adaptor `EasyOCR`), perbaikan salah baca karakter optik (`.HIL.ID` kembali ke `.mil.id`), serta deteksi modus calo rekrutmen dan berkas `.apk`. |
| Orkestrasi API, Kontainer, & Benchmark | `app/scanner_service.py`, `app/main.py`, `app/models.py`, `Dockerfile`, `scripts/*` | Zuan | Alur pemindaian asinkron URL dan gambar, unggah paralel ke Supabase Storage, pencatatan latensi per tahap, kontainer Docker multi-tahap (`TORCH_PROFILE=none/cpu/gpu`), serta skrip uji akurasi 95 sampel. |
| Pemeriksa Domain & Penggabungan Skor | `app/domain_guard.py`, `app/scoring.py`, `app/security.py` | Denin & Zuan | Daftar resmi domain `.mil.id`/`.go.id`, pendeteksi *typosquatting*, *homoglyph*, IDN *punycode*, dan *bait subdomain*, serta rumus bobot `45% Visual + 30% DOM + 25% Domain` dengan lima aturan pengunci deterministik. |
| Router Triage & Webhook WhatsApp | `app/wa_triage.py`, `app/webhook_openwa.py`, `app/webhook_wa.py`, `app/supabase_client.py` | Denin | Pemilahan pesan masuk (tautan URL, foto poster, perintah bantuan), pencegahan proses ganda (*idempotency key*), verifikasi HMAC-SHA256, pengiriman balasan beserta gambar beranotasi, dan sinkronisasi tabel `scan_incidents`. |
| Antarmuka Pusat Komando SOC (47 Berkas) | `frontend-soc/src/**` | Denin | Aplikasi web Next.js App Router yang memuat konsol uji Sandbox, perbandingan visual berdampingan dengan lapisan koordinat temuan, rincian latensi per tahap, halaman audit hasil benchmark, simulator WhatsApp, serta ekspor aturan blokir DNS Sinkhole (RPZ, Hosts, Firewall). |
| Sasaran Uji Simulasi Lokal | `mock_targets/*.html`, `mock_targets/assets/*` | Zuan & Denin | Berkas HTML statis lokal dan poster kode QR simulasi yang aman dipakai untuk peragaan juri tanpa skrip berbahaya aktif. |

---

## 3. Daftar Pustaka Open-Source dan Layanan Pihak Ketiga

### 3.1 Layanan Backend dan Computer Vision (`backend-engine`)

| Pustaka / Runtime | Versi | Lisensi | Status | Peran Teknis di Dalam Sistem |
| :--- | :--- | :--- | :--- | :--- |
| Python | `3.12` (Docker) / `3.13+` | PSF License | Aktif | Bahasa utama layanan API dan pemrosesan citra. |
| FastAPI | `>= 0.115.0` | MIT | Aktif | Kerangka kerja REST API asinkron untuk endpoint pemindaian dan webhook. |
| Uvicorn | `>= 0.30.6` | BSD-3-Clause | Aktif | Server ASGI penjalan aplikasi FastAPI. |
| Pydantic | `>= 2.9.2` | MIT | Aktif | Validasi struktur JSON permintaan dan respons API. |
| Playwright + Chromium | `>= 1.47.0` | Apache-2.0 / BSD | Aktif | Peramban tanpa antarmuka untuk merender halaman target (`1280x720`) dan mengekstrak koordinat DOM. |
| OpenCV (`opencv-python-headless`) | `>= 4.10.0.84` | Apache-2.0 | Aktif | Operasi citra untuk perhitungan komponen SSIM, *masked template matching* lambang, pembacaan QR berlapis, dan penggambaran kotak temuan. |
| NumPy | `>= 1.26.4` | BSD-3-Clause | Aktif | Perhitungan matriks `float32` ter-vektorisasi pada modul kemiripan dan detektor lambang. |
| HTTPX | `>= 0.27.2` | BSD-3-Clause | Aktif | Klien HTTP asinkron untuk koneksi ke Supabase REST API dan gateway OpenWA. |
| Python-Multipart | `>= 0.0.12` | Apache-2.0 | Aktif | Pembacaan unggahan berkas gambar (`multipart/form-data`) pada `/api/v1/scan-image`. |
| PyZbar + `libzbar0` | `>= 0.1.9` | MIT / LGPL-2.1 | Aktif | Pembaca kode QR pendamping OpenCV untuk poster berkontras rendah atau posisi miring. |
| Tesseract OCR (`ind+eng`) | `5.x` (Debian) | Apache-2.0 | Aktif (Linux) | Mesin pembaca teks optik Bahasa Indonesia dan Inggris di dalam kontainer Docker. |
| Windows.Media.Ocr (WinRT) | Bawaan OS | Microsoft OS | Aktif (Win32) | Mesin pembaca teks optik bawaan sistem operasi saat pengujian lokal di Windows. |
| PyTorch (`torch`, `torchvision`) | `>= 2.2.0` | BSD-3-Clause | Opsional (`cpu`/`gpu`) | Runtime jaringan saraf tiruan opsional pada profil kompilasi kontainer `TORCH_PROFILE=cpu` atau `gpu` (`requirements-easyocr.txt`). |
| EasyOCR | `>= 1.7.1` | Apache-2.0 | Opsional (`cpu`/`gpu`) | Mesin OCR berbasis *deep learning* yang dimuat saat diaktifkan lewat `VK_OCR_BACKEND=easyocr`. |
| Debian Bookworm Slim + Tini | `12` | DFSG / MIT | Aktif (Docker) | Image dasar kontainer minimal beserta *init reaper* PID 1 (`tini`) untuk membersihkan proses anak Chromium. |

Catatan mengenai perubahan pilihan pustaka *vision*: pada dokumen pengantar awal repositori, kami sempat menuliskan rencana pemakaian `YOLOv8` dan `CLIP/DINOv2`. Ketika diimplementasikan dan diuji kecepatannya, kami memilih menulis sendiri detektor piramida *template matching* ber-masker alfa dan SSIM pra-komputasi murni menggunakan OpenCV dan NumPy. Langkah ini menekan median waktu periksa ke kisaran 1,5 detik pada prosesor biasa tanpa memerlukan kartu grafis (GPU) maupun unduhan model ratusan megabita.

### 3.2 Antarmuka SOC dan Integrasi Eksternal (`frontend-soc`)

| Pustaka / Layanan | Versi | Lisensi | Peran Teknis di Dalam Sistem |
| :--- | :--- | :--- | :--- |
| Next.js | `16.4.4` | MIT | Kerangka kerja aplikasi web React untuk Dashboard SOC. |
| React & React DOM | `19.3.0` | MIT | Pustaka komponen antarmuka pengguna. |
| Tailwind CSS | `4.x` | MIT | Penataan gaya tampilan antarmuka web. |
| `@supabase/supabase-js` | `^2.118.0` | MIT | Klien berlangganan WebSocket Realtime pada tabel `scan_incidents`. |
| Supabase Cloud | Layanan Terkelola | Apache-2.0 / Open-Core | Basis data PostgreSQL log insiden, saluran notifikasi langsung, dan penyimpanan berkas gambar bukti. |
| OpenWA Gateway (Baileys) | Layanan Terpisah | MIT | Jembatan penerimaan pesan dan pengiriman gambar balasan WhatsApp di luar image kontainer utama. |

---

## 4. Sumber Aset Referensi dan Himpunan Data Uji

| Kelompok Aset | Lokasi Penyimpanan | Jumlah | Asal Perolehan dan Tujuan Pemakaian |
| :--- | :--- | :---: | :--- |
| Lambang resmi instansi pertahanan & siber | `app/reference_db/logos/*.png` | 41 berkas | Diambil dari repositori terbuka Wikimedia Commons dan situs publik instansi terkait (Mabes TNI, TNI AD Kartika Eka Paksi, 15 Kodam, Kostrad, Kopassus, Kemhan RI, Akmil, Unhan, BSSN, BNPT, Lemhannas, Basarnas, Bakamla). Dipakai khusus sebagai acuan defensif untuk mendeteksi pencatutan lambang oleh pembuat situs atau poster palsu. |
| Tangkapan layar beranda portal resmi | `app/reference_db/portals/*.png` & `manifest.json` | 37 berkas | Diambil dari halaman depan publik domain `.mil.id`, `.go.id`, dan `.ac.id` yang dapat diakses umum tanpa masuk ke akun internal maupun sistem tertutup. |
| Sampel pengujian benchmark Phase 3 | `storage/dataset/` & `mock_targets/` | 95 sampel | Mencakup 12 halaman HTML lokal, 24 poster buatan untuk pengujian (calo berbayar, QR *Quishing*, berkas `.apk`, poster resmi gratis, dan poster umum), 22 tangkapan layar situs sipil umum, serta 37 tangkapan layar beranda portal resmi. Tidak ada data pribadi atau kredensial nyata di dalamnya. |

---

## 5. Rujukan Literatur Ilmiah

Gagasan memeriksa kesesuaian antara identitas visual lambang pada halaman dengan kepemilikan domain merujuk pada empat makalah ilmiah terbuka berikut:

1. Lin, Y., Liu, R., Divakaran, D. M., Ng, J. Y., Chan, Q. Z., Lu, Y., Si, Y., Zhang, F., & Dong, J. S. (2021). *Phishpedia: A Hybrid Deep Learning Based Approach to Visually Identify Phishing Webpages*. USENIX Security Symposium 2021.
2. Liu, R., Lin, Y., Yang, X., Ng, S. H., Divakaran, D. M., & Dong, J. S. (2022). *Inferring Phishing Intention via Webpage Appearance and Dynamics: A Deep Vision Based Approach*. USENIX Security Symposium 2022.
3. Abdelnabi, S., Krombholz, K., & Fritz, M. (2020). *VisualPhishNet: Zero-Day Phishing Website Detection by Visual Similarity*. ACM CCS 2020.
4. Prasad, A., & Chandra, S. (2024). *PhiUSIIL: A diverse security profile empowered phishing URL detection framework based on similarity index and incremental learning*. Computers & Security, 136.

Kami hanya mengadopsi konsep pengujian ketidakcocokan merek dan domain (*Identity-Domain Mismatch*) dari literatur di atas. Seluruh implementasi kode, daftar kata kunci kredensial militer Indonesia, aturan domain `.mil.id`, dan pembobotan risiko pada folder `app/` kami tulis mandiri tanpa menyalin kode maupun bobot model dari keempat publikasi tersebut.

---

## 6. Jaminan Keamanan Lingkungan Demo dan Privasi (Bab N)

Seluruh sasaran uji *phishing* pada folder `mock_targets/` berupa berkas HTML statis lokal yang hanya berjalan di dalam lingkungan peragaan. Tidak ada muatan eksploitasi, pencatat ketikan (*keylogger*), ataupun pengiriman data ke peladen eksternal.

Di sisi server, peramban Chromium dijalankan menggunakan akun non-root (`pwuser`, `UID 10001`), menolak semua unduhan berkas (`accept_downloads=False`), memblokir *ServiceWorker*, membatasi alokasi memori V8 maksimal 256 MB, serta memutus permintaan *sub-request* yang mengarah ke skema lokal `file://`, alamat metadata cloud `169.254.169.254`, maupun jaringan privat RFC1918. Untuk melindungi privasi pelapor di lapangan, nomor telepon pengirim pada kanal WhatsApp selalu disamarkan sebelum ditulis ke log sistem (contoh: `62812****890@c.us`) melalui fungsi pada `app/security.py`, dan tidak ada kunci rahasia yang disimpan di dalam repositori maupun image Docker.
