# Panduan Deploy — SOC Dashboard & Backend Engine

Dokumen ini mencatat langkah deploy beserta jebakan yang **hanya muncul di
produksi** dan lolos sepenuhnya saat pengujian lokal.

Arsitektur deploy:

```
Peramban juri ──HTTPS──> Vercel (frontend-soc)
       │
       └──HTTPS──> Backend engine (Railway / Cloudflare Tunnel) ──> Supabase
```

Frontend memanggil engine **langsung dari peramban**. Tidak ada proxy sisi
server, karena fungsi serverless Vercel dibatasi 10 detik sementara satu
pemindaian URL bisa memakan belasan detik — proxy semacam itu lulus di lokal
lalu gagal di produksi.

---

## 1. Backend engine

### 1.1 Wajib HTTPS

Halaman HTTPS tidak boleh memanggil endpoint HTTP; peramban memblokirnya tanpa
pesan yang jelas di antarmuka. Jadi engine harus dilayani melalui TLS:

- **Railway** (target pada README §9) — menerbitkan domain HTTPS otomatis.
- **Cloudflare Tunnel** — `cloudflared tunnel --url http://localhost:8000`,
  memberi sertifikat sah dalam hitungan menit tanpa mengubah kode.
  Catatan: *quick tunnel* mengganti nama host setiap kali dijalankan ulang.

### 1.2 `CORS_ORIGINS` dibaca sekali saat start

`app/main.py` menyusun `CORSMiddleware` pada saat impor, dengan
`security.cors_origins()` dievaluasi di sana. **Mengubah `.env` saja tidak
cukup — engine harus direstart.** Tanpa itu, setiap panggilan dari origin
Vercel akan ditolak meskipun nilainya sudah benar di berkas.

```bash
# .env pada root repositori
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://<proyek>.vercel.app
PUBLIC_BACKEND_URL=https://<host-engine-publik>
```

`PUBLIC_BACKEND_URL` menentukan URL bukti cadangan (`/static/...`) dan URL
target simulasi pada `/api/v1/mock-targets`. Bila masih `localhost`, tombol
"Uji Cepat Juri" pada dasbor akan menunjuk ke mesin pengunjung, bukan ke engine.

Jangan pernah mengisi `CORS_ORIGINS=*`. Engine tidak memiliki autentikasi, dan
origin terbuka berarti siapa pun dapat menyuruhnya mengambil URL sembarang.

### 1.3 Menjalankan

```bash
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000
```

Docker tersedia melalui `Dockerfile` (Playwright + non-root `pwuser`).

---

## 2. Frontend (Vercel)

### 2.1 Pengaturan proyek

- **Root Directory**: `frontend-soc` — tanpa ini, build tidak menemukan aplikasi.
- Framework terdeteksi otomatis sebagai Next.js; `npm run build` sudah memakai
  jalur webpack.

### 2.2 Variabel lingkungan

| Variabel | Nilai |
| :--- | :--- |
| `NEXT_PUBLIC_BACKEND_URL` | URL HTTPS engine |
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyek Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Kunci **anon** (bukan service role) |

Seluruhnya `NEXT_PUBLIC_*`, jadi nilainya ikut masuk ke bundel peramban dan
bersifat publik. Itu memang sesuai desain: RLS sudah mengizinkan `anon` membaca
`scan_incidents`, dan engine tidak memakai autentikasi.

Bila `NEXT_PUBLIC_BACKEND_URL` tidak diisi, aplikasi jatuh ke
`http://localhost:8000` dan strip status akan menampilkan "Mesin: Luring".
Alamat engine juga dapat diganti saat berjalan melalui popover "Alamat Mesin"
di header — tersimpan pada `localStorage`, berguna ketika nama host tunnel
berubah tanpa perlu build ulang.

---

## 3. Daftar periksa setelah deploy

1. Buka tautan Vercel dari perangkat **selain** mesin pengembangan.
2. Pastikan strip header menampilkan *Mesin: Daring* dan *Basis Data: Daring*.
3. Jalankan satu "Uji Cepat Juri" sampai muncul halaman Forensik.
4. Periksa gambar bukti termuat (lintas-origin dari Supabase Storage).
5. **Ulangi pada Safari**, bukan hanya Chrome: Safari memblokir konten campuran
   lebih ketat, dan Chrome memperlakukan permintaan ke jaringan privat secara
   khusus (*Private Network Access*) — keduanya hanya terlihat di produksi.
6. Unduh satu berkas dari halaman Mitigasi dan pastikan isinya wajar.

---

## 4. Setelah penjurian

Matikan tunnel publik. Engine tidak memiliki autentikasi, sehingga membiarkannya
terbuka berarti membiarkan pihak luar menjalankan pemindaian atas nama
infrastruktur ini.
