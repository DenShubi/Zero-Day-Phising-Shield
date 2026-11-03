# 📊 Phase 3 Audit Report: Evaluasi Akurasi Deteksi & Latensi Capture Playwright

**Sistem**: VisiKartika Shield (`Zero-Day-Phising-Shield`)  
**Waktu Audit**: `2026-11-02 21:06:56 SE Asia Standard Time`  
**Target SLA Respons Lapangan**: `< 5.0 detik` (`5.000 ms`)  
**Total Sampel Evaluasi**: **95 sampel** across 4 korpus uji multimodal + uji beban konkuren Playwright

---

## 1. Ringkasan Eksekutif (Executive Summary)

| Indikator Utama (KPI Phase 3) | Hasil Pengukuran | Target / Ambang | Status |
| :--- | :---: | :---: | :---: |
| **Akurasi Keseluruhan (*Overall Accuracy*)** | **100.00%** (`95% CI: 100.00%–100.00%`) | `>= 92.0%` | ✅ **LULUS** |
| **F1-Score Deteksi Ancaman** | **100.00%** (`95% CI: 100.00%–100.00%`) | `>= 90.0%` | ✅ **LULUS** |
| **Recall / Sensitivity (Tangkap Phishing & Scam)** | **100.00%** (`FN = 0`) | `>= 95.0%` | ✅ **LULUS** |
| **Specificity / True Negative Rate (Web & Poster Aman)** | **100.00%** (`FP = 0`) | `>= 90.0%` | ✅ **LULUS** |
| **ROC-AUC / PR-AUC** | **`1.0000` / `0.9803`** | `>= 0.9500` | ✅ **LULUS** |
| **Latensi Warm Capture Playwright + Vision (P50 / P95)** | **`1.510s` / `2.232s`** | `< 5.000s` | ✅ **LULUS (100%)** |
| **Latensi Scan Gambar/Poster Multimodal (P50 / P95)** | **`1.592s` / `1.873s`** | `< 5.000s` | ✅ **LULUS (100%)** |
| **Uji Konkurensi Sandbox (`4x Simultan`)** | **Maks `4.291s`/req** (Batch `4.292s`) | `< 5.000s` | ✅ **LULUS** |

---

## 2. Confusion Matrix & Evaluasi Per-Slice (Slice-Based Error Analysis)

### A. Confusion Matrix Agregat

| Aktual \ Prediksi | Prediksi: **THREAT** (`CRITICAL_PHISHING` / `SUSPICIOUS`) | Prediksi: **SAFE** | Total Aktual |
| :--- | :---: | :---: | :---: |
| **Aktual: THREAT (Phishing / Calo / Malware APK)** | **TP = 20** | FN = 0 | 20 |
| **Aktual: SAFE (Portal `.mil.id` / Web Umum / Poster Resmi)** | FP = 0 | **TN = 75** | 75 |

### B. Akurasi & Latensi Berdasarkan Slice Dataset

| Slice Evaluasi | Modalitas | Sampel (`N`) | Benar | Akurasi | Mean Latency | P95 Latency | `< 5s` SLA |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Sandbox URL (Phishing, Zero-Day & Benign HTML)** | `URL_PLAYWRIGHT` | 12 | 12 | **100.00%** | `1.576s` | `2.232s` | `100.0%` |
| **2. Poster & Scam Multimodal (Calo, QR, APK, Resmi & Kampus)** | `IMAGE_MULTIMODAL` | 24 | 24 | **100.00%** | `1.614s` | `1.961s` | `100.0%` |
| **3. Screenshot Web Umum Non-TNI (Berita, Kampus, Pemerintah Sipil, Tech)** | `IMAGE_MULTIMODAL` | 22 | 22 | **100.00%** | `1.606s` | `1.756s` | `100.0%` |
| **4. Beranda Portal Resmi TNI/Pertahanan (.mil.id / .go.id / .ac.id)** | `IMAGE_MULTIMODAL` | 37 | 37 | **100.00%** | `1.638s` | `1.804s` | `100.0%` |

---

## 3. Perbandingan Terhadap Model Baseline (Ablation & Model Comparison)

Pengujian ini membuktikan mengapa pendekatan tunggal (*Domain-only* atau *SSIM-only*) gagal menghadapi serangan *multi-vektor* (seperti tangkapan layar login tanpa URL atau poster pungli calo rekrutmen):

| Pendekatan / Model | Accuracy | Precision | Recall | Specificity | F1-Score | ROC-AUC | PR-AUC |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Naive Majority Baseline | 78.95% | 0.00% | 0.00% | 100.00% | 0.00% | `0.5000` | `0.6053` |
| Domain/URL Heuristic Only | 87.37% | 70.00% | 70.00% | 92.00% | 70.00% | `0.9740` | `0.8291` |
| Visual Similarity Only (SSIM) | 89.47% | 100.00% | 50.00% | 100.00% | 66.67% | `0.5737` | `0.6143` |
| **VisiKartika Multimodal Fusion (Phase 3)** | **100.00%** | 100.00% | 100.00% | 100.00% | **100.00%** | `1.0000` | `0.9803` |

---

## 4. Audit Latensi Playwright Headless Sandbox & Computer Vision

- **Pre-Warm Chromium Pool (`scanner.warmup()`)**: `3599.5 ms` *(dieksekusi satu kali saat inisialisasi worker; pemindaian berikutnya menggunakan konteks terisolasi di atas instance Chromium hangat)*.

### A. Distribusi Latensi End-to-End

| Jalur Pipeline | `N` | Min | Mean | Median (P50) | P90 | P95 | Max | Kepatuhan `< 5.0s` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **URL Scan (`Playwright + DOM + SSIM + Logo + Fusion`)** | 12 | `1.144s` | `1.576s` | **`1.510s`** | `1.609s` | **`2.232s`** | `2.990s` | **100.0%** |
| **Image Scan (`SSIM + WinRT/Tesseract OCR + Logo + QR`)** | 83 | `1.375s` | `1.623s` | **`1.592s`** | `1.759s` | **`1.873s`** | `2.205s` | **100.0%** |

### B. Rata-Rata Waktu Eksekusi Per Tahap (Stage-Level Telemetry)

| Tahap Pipeline URL Scan (`Phase 2`) | Rata-Rata (`ms`) | Tahap Pipeline Image Scan (`Multimodal`) | Rata-Rata (`ms`) |
| :--- | :---: | :--- | :---: |
| 1. Acquire Isolated BrowserContext | `66.5 ms` | 1. Image Decode & Sandbox I/O | `33.2 ms` |
| 2. Playwright `goto(domcontentloaded)` | `23.0 ms` | 2. Portal Layout Similarity (37 Portals) | `46.3 ms` |
| 3. Adaptive Render & Image Settle | `213.5 ms` | 3. Layout + Visual Form + Warm OCR | `94.0 ms` |
| 4. Viewport PNG + JS DOM Extraction | `73.1 ms` | 4. Full-Canvas Multi-Scale Logo (41 Logos) | `1258.8 ms` |
| 5. OpenCV DOM Bounding-Box Annotator | `20.6 ms` | 5. Multi-Pass QR Quishing Decoder | `187.7 ms` |
| 6. Portal Layout Similarity (37 Portals) | `104.3 ms` | 6. Context-Aware Risk Fusion | `0.1 ms` |
| 7. Banner/DOM Logo Detector (41 Logos) | `1065.9 ms` | — | — |
| 8. Context-Aware Risk Fusion | `0.0 ms` | — | — |

### C. Optimasi Arsitektur yang Diterapkan pada Phase 3
1. **Warm Playwright Browser Pool (`_WarmPlaywrightPool`)**: Mempertahankan proses *headless Chromium* tetap hangat lintas-pemindaian dengan `BrowserContext` baru yang 100% terisolasi per URL (`Semaphore(4)`), memangkas *cold-start overhead* Chromium (~1.500 ms) menjadi `~25–45 ms`.
2. **Adaptive Double-`requestAnimationFrame` Settle & Broken-`<img>` Fix**: Mengganti `wait_for_timeout(1500)` statis dengan sinkronisasi *paint frame* adaptif (`~150 ms`) serta memperbaiki pengecekan `img.complete` agar gambar rusak (`HTTP 404`) tidak lagi memicu penundaan `5.000 ms`.
3. **Precomputed `float32` SSIM Statistics (`320×180`)**: Menyimpan statistik Gaussian `(mu, sigma_sq)` untuk 37 portal referensi di memori sehingga pencocokan kemiripan tata letak turun dari `~2.550 ms` menjadi **`~50 ms`** per gambar.
4. **Pre-Cached Coarse Grayscale Logo Pyramids**: Membangun piramida skala kasar untuk 41 lambang resmi militer satu kali saat inisialisasi dan melakukan komposisi latar lokal adaptif pada tahap *refinement*.
5. **Persistent Direct-Stream WinRT OCR Worker**: Memproses OCR secara *in-memory stream* (`AsRandomAccessStream`) di atas worker persisten tanpa melalui *WinRT StorageFile Broker*, menurunkan latensi OCR hangat ke **`< 80 ms`**.
