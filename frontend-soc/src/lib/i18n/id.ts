/**
 * Indonesian UI strings, in one flat table.
 *
 * This is deliberately a plain object rather than an i18n framework: the app is
 * single-language, and the table exists to enforce consistent terminology (one
 * spelling of "Pemindaian", one label per verdict) rather than to support
 * switching languages. Code identifiers stay English; everything the operator
 * reads lives here.
 */

export const id = {
  app: {
    name: 'VisiKartika Shield',
    subtitle: 'Pusat Komando Siber — Penangkalan Phishing',
    org: 'PUSSIBERAD TNI AD',
  },

  nav: {
    command: 'Pusat Komando',
    sandbox: 'Konsol Pemindaian',
    forensics: 'Forensik',
    audit: 'Audit Akurasi',
    mitigation: 'Mitigasi',
    whatsapp: 'Simulasi Lapor Cepat',
  },

  health: {
    engine: 'Mesin',
    database: 'Basis Data',
    online: 'Daring',
    offline: 'Luring',
    checking: 'Memeriksa…',
    backendUrl: 'Alamat Mesin',
    backendUrlHint:
      'Ubah bila mesin berjalan di alamat lain (mis. tunnel publik). Tersimpan di peramban ini saja.',
    reset: 'Kembalikan ke bawaan',
    save: 'Simpan',
  },

  feed: {
    title: 'Insiden Terkini',
    empty: 'Belum ada insiden. Jalankan pemindaian dari Konsol untuk memulai.',
    unconfigured: 'Supabase belum dikonfigurasi — menampilkan riwayat dari mesin tanpa pembaruan langsung.',
    connecting: 'Menyambung…',
    live: 'Langsung',
    reconnecting: 'Menyambung ulang…',
    offline: 'Terputus',
    refresh: 'Muat ulang',
  },

  verdictAdvice: {
    SAFE: 'Tidak ditemukan indikasi penyamaran identitas maupun pencurian kredensial.',
    SUSPICIOUS: 'Anomali parsial ditemukan. Masuk antrean peninjauan analis SOC.',
    CRITICAL_PHISHING:
      'Ancaman kritis. Rekomendasi pemblokiran otomatis melalui DNS Sinkhole / aturan firewall.',
  },

  score: {
    total: 'Skor Risiko Total',
    visual: 'Kemiripan Visual',
    dom: 'Anomali DOM',
    domain: 'Telemetri Domain',
    notApplicable: 'Tidak berlaku (tanpa URL)',
    weightedBase: 'Basis terbobot',
    ruleDelta: 'Penyesuaian aturan',
    final: 'Skor akhir',
    appliedRules: 'Aturan Deterministik yang Diterapkan',
    noRules: 'Tidak ada aturan penyesuaian yang aktif — skor murni dari pembobotan.',
  },

  scan: {
    title: 'Konsol Pemindaian',
    urlLabel: 'Tautan Target',
    urlPlaceholder: 'https://contoh-portal.example.com',
    imageLabel: 'Poster / Tangkapan Layar',
    imageHint: 'Seret berkas ke sini, tempel dari papan klip, atau pilih berkas.',
    captionLabel: 'Keterangan (opsional)',
    unitLabel: 'Satuan Pelapor',
    submit: 'Mulai Pemindaian',
    cancel: 'Batalkan',
    scanning: 'Memindai…',
    warmup: 'Memanaskan mesin…',
    judgeTest: 'Uji Cepat Juri',
    judgeTestHint: 'Target simulasi legal yang di-host sendiri, aman untuk dipindai.',
    safeControl: 'Kontrol Aman (portal resmi)',
    domainPreview: 'Pratinjau Telemetri Domain',
  },

  forensics: {
    title: 'Forensik Detail',
    evidence: 'Bukti Visual',
    rawView: 'Tangkapan Asli + Anotasi Interaktif',
    burnedView: 'Bukti Ber-anotasi (seperti dikirim ke WhatsApp)',
    reference: 'Pembanding Portal Resmi',
    noReference: 'Tidak ada portal resmi yang cocok untuk dibandingkan.',
    domTelemetry: 'Telemetri DOM & Eksfiltrasi Formulir',
    multimodal: 'Analisis Multimodal (OCR & QR)',
    findings: 'Temuan Forensik',
    latency: 'Rincian Latensi',
    degraded:
      'Dimuat dari basis data: sebagian rincian tidak tersimpan. Jalankan Pindai Ulang untuk analisis lengkap.',
    rescan: 'Pindai Ulang',
    notSynced:
      'Insiden belum tersinkron ke basis data pusat — tampilan bersifat sementara dan hanya ada di sesi ini.',
    resync: 'Sinkron Ulang',
    print: 'Cetak Laporan',
    notFound: 'Insiden tidak ditemukan.',
  },

  mitigation: {
    title: 'Mitigasi Otomatis',
    subtitle: 'Pembuat DNS Sinkhole & Daftar Blokir Firewall',
    selectAll: 'Pilih semua',
    lowConfidence: 'keyakinan rendah',
    provenance: 'Sumber Indikator',
    download: 'Unduh',
    simulationNotice:
      'Indikator berasal dari simulasi internal. Tinjau secara manual sebelum diterapkan pada resolver produksi.',
  },

  common: {
    loading: 'Memuat…',
    error: 'Terjadi kesalahan',
    retry: 'Coba lagi',
    copy: 'Salin',
    copied: 'Tersalin',
    defang: 'Amankan tautan',
    close: 'Tutup',
    ticket: 'ID Tiket SOC',
    unit: 'Satuan',
    source: 'Kanal',
    time: 'Waktu',
    unmapped: 'Asal tidak terpeta',
  },
} as const;

export type Strings = typeof id;
