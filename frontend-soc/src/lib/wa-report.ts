/**
 * TypeScript port of the bot's reply formatting.
 *
 * Mirrors app/wa_triage.py:
 *   SEP                  line 175
 *   _verdict_block       lines 245-324
 *   _is_public_evidence_url  line 327
 *   _ticket_line         line 331
 *   format_url_report    lines 337-367
 *   format_image_report  lines 369-404
 *
 * This reimplements PRESENTATION ONLY. Every score, verdict, finding and ticket
 * shown in the simulation comes from a real scan through the same endpoints the
 * bot calls — no detection logic is duplicated here, so the two cannot disagree
 * about a result, only about wording.
 *
 * Keep these strings in sync with wa_triage.py when the bot's copy changes.
 */

import type { NormalizedScan } from './normalize';
import type { Verdict } from './verdict';

export const SEP = '━━━━━━━━━━━━━━━━━━━━━━';

type ReportKind = 'URL' | 'IMAGE';

/** (header, status label, closing advice) — the triple wa_triage.py returns. */
type VerdictBlock = readonly [string, string, string];

/**
 * Faithful port of _verdict_block: a pure function of verdict, kind and
 * content category, with no engine state involved.
 */
export function verdictBlock(
  verdict: Verdict,
  kind: ReportKind,
  contentCategory = 'UNKNOWN',
): VerdictBlock {
  if (verdict === 'CRITICAL_PHISHING') {
    if (kind === 'IMAGE') {
      if (contentCategory === 'GENERIC_PHISHING') {
        return [
          '🚨 *PERINGATAN KRITIS: GAMBAR / POSTER PENIPUAN SIBER TERDETEKSI!*',
          'BERBAHAYA (CRITICAL PHISHING / SCAM)',
          '⛔ *INSTRUKSI TAKTIS*:\n' +
            '• *JANGAN* memindai QR Code, mengunduh file `.apk`, atau mengisi PIN/OTP/kata sandi!\n' +
            '• Gambar ini mengandung tautan atau pola penipuan siber berisiko tinggi.\n' +
            '• Bukti visual ber-anotasi telah diteruskan ke *Dashboard SOC PUSSIBERAD*.',
        ];
      }
      return [
        '🚨 *PERINGATAN KRITIS: POSTER / GAMBAR PHISHING MILITER TERDETEKSI!*',
        'BERBAHAYA (CRITICAL PHISHING / QUISHING)',
        '⛔ *INSTRUKSI TAKTIS*:\n' +
          '• *JANGAN* memindai (_scan_) QR Code, menghubungi nomor calo, atau membuka tautan pada gambar ini!\n' +
          '• Gambar ini mencatut atribut militer resmi untuk penipuan/pencurian data di luar `.mil.id`.\n' +
          '• Bukti visual ber-anotasi telah diteruskan ke *Dashboard SOC PUSSIBERAD*.',
      ];
    }
    if (contentCategory === 'GENERIC_PHISHING') {
      return [
        '🚨 *PERINGATAN KRITIS: SITUS PHISHING BERBAHAYA TERDETEKSI!*',
        'BERBAHAYA (CRITICAL PHISHING)',
        '⛔ *INSTRUKSI TAKTIS*:\n' +
          '• *JANGAN* masukkan kata sandi, PIN, kode OTP, atau data pribadi pada tautan ini!\n' +
          '• Tautan menggunakan infrastruktur mencurigakan yang berpotensi mencuri kredensial Anda.',
      ];
    }
    return [
      '🚨 *PERINGATAN KRITIS: PHISHING TERDETEKSI!*',
      'BERBAHAYA (CRITICAL PHISHING)',
      '⛔ *INSTRUKSI TAKTIS*:\n' +
        '• *JANGAN* masukkan NRP, NIK, kata sandi, PIN, atau kode OTP!\n' +
        '• *JANGAN* menyebarkan tautan ini ke grup satuan/keluarga.\n' +
        '• Bukti forensik telah dikirim otomatis ke *Dashboard SOC PUSSIBERAD* untuk pemblokiran domain.',
    ];
  }

  if (verdict === 'SUSPICIOUS') {
    if (kind === 'IMAGE') {
      return [
        '⚠️ *WASPADA: GAMBAR / POSTER MENCURIGAKAN*',
        'MENCURIGAKAN (SUSPICIOUS)',
        '⚠️ *INSTRUKSI TAKTIS*:\n' +
          '• Gambar memiliki indikator anomali atau atribut tanpa verifikasi domain resmi `.mil.id`.\n' +
          '• Pastikan Anda hanya mengakses portal resmi melalui daftar ketik `portal`.',
      ];
    }
    return [
      '⚠️ *WASPADA: TAUTAN MENCURIGAKAN*',
      'MENCURIGAKAN (SUSPICIOUS)',
      '⚠️ *INSTRUKSI TAKTIS*:\n' +
        '• Tautan ini memiliki anomali keamanan dan bukan portal resmi `.mil.id`.\n' +
        '• Hindari mengisi data pribadi atau kredensial kedinasan sebelum diverifikasi petugas siber satuan.',
    ];
  }

  if (kind === 'IMAGE') {
    if (contentCategory === 'OFFICIAL_MILITARY' || contentCategory === 'POSTER_OFFICIAL_MILITARY') {
      return [
        '✅ *AMAN: PUBLIKASI / ATRIBUT MILITER RESMI*',
        'AMAN (VERIFIED SAFE — KONTEN MILITER)',
        '✅ *INFORMASI*:\n' +
          '• Konten memuat atribut/informasi resmi tanpa tautan phishing, QR palsu, maupun indikasi pungutan calo.',
      ];
    }
    return [
      '✅ *AMAN: GAMBAR / SCREENSHOT UMUM (BUKAN PHISHING & BUKAN TNI)*',
      'AMAN (VERIFIED SAFE — KONTEN UMUM NON-TNI)',
      '✅ *INFORMASI*:\n' +
        '• Gambar ini merupakan tangkapan layar web atau poster umum non-militer dan tidak mengandung indikasi phishing maupun penyalahgunaan atribut TNI AD.',
    ];
  }

  if (contentCategory === 'OFFICIAL_MILITARY') {
    return [
      '✅ *AMAN: PORTAL RESMI TERVERIFIKASI*',
      'AMAN (VERIFIED SAFE — PORTAL RESMI .MIL.ID)',
      '✅ *INFORMASI*:\n' +
        '• Domain terkonfirmasi sebagai portal resmi dalam daftar putih (*Whitelist*) TNI AD / Kemhan RI.',
    ];
  }

  return [
    '✅ *AMAN: SITUS WEB UMUM NON-MILITER (BUKAN PHISHING)*',
    'AMAN (VERIFIED SAFE — SITUS UMUM NON-TNI)',
    '✅ *INFORMASI*:\n' +
      '• Situs ini bukan portal kedinasan TNI AD, namun terkonfirmasi aman dan tidak ditemukan pencurian kredensial maupun pemalsuan identitas militer.\n' +
      '• Gunakan kredensial kedinasan (NRP/Sisfopers) *hanya* pada domain resmi `.mil.id`.',
  ];
}

/** Port of _is_public_evidence_url: a localhost URL is useless inside WhatsApp. */
export function isPublicEvidenceUrl(url: string | null): boolean {
  return Boolean(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url ?? '');
}

/** Port of _ticket_line. */
export function ticketLine(incidentId: string | null): string | null {
  if (!incidentId) return null;
  const seg = incidentId.split('-')[0];
  return seg ? `🆔 *ID Tiket SOC*: \`#VK-${seg.toUpperCase()}\`` : null;
}

const fixed = (n: number, places = 1) => n.toFixed(places);

/** Port of format_url_report. */
export function formatUrlReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  const category =
    scan.contentCategory || (scan.url?.isOfficialMilDomain ? 'OFFICIAL_MILITARY' : 'UNKNOWN');
  const [header, statusLabel, advice] = verdictBlock(scan.verdict, 'URL', category);

  const lines: string[] = [
    header,
    '_VisiKartika Shield — Hasil Analisis Forensik URL_',
    SEP,
    `🔗 *Tautan Target*: ${scan.finalUrl ?? scan.submittedUrl ?? '-'}`,
    `🛡️ *Status Putusan*: *${statusLabel}*`,
    `📈 *Skor Risiko Total*: *${fixed(scan.scores.total)} / 100*`,
    `   ├─ Kemiripan Visual: \`${fixed(scan.scores.visual)}%\``,
    `   ├─ Anomali Struktur DOM: \`${fixed(scan.scores.dom)}%\``,
    `   └─ Telemetri Domain: \`${fixed(scan.scores.domain ?? 0)}%\``,
  ];

  if (scan.impersonatedTarget && scan.verdict !== 'SAFE') {
    lines.push(`🎭 *Indikasi Penyamaran*: ${scan.impersonatedTarget}`);
  }
  if (scan.detectedLogos.length > 0) {
    const brands = scan.detectedLogos
      .slice(0, 2)
      .map((l) => `${l.brandName} (${fixed(l.confidence, 0)}%)`)
      .join(', ');
    lines.push(`🎖️ *Atribut Militer Terdeteksi*: ${brands}`);
  }
  if (scan.forensicReasons.length > 0) {
    lines.push('\n🔍 *Temuan Forensik Utama*:');
    lines.push(...scan.forensicReasons.slice(0, 3).map((r) => `  • ${r}`));
  }
  if (includeEvidenceLink && isPublicEvidenceUrl(scan.annotatedUrl)) {
    lines.push(`\n🖼️ *Bukti Visual*: ${scan.annotatedUrl}`);
  }
  const ticket = ticketLine(scan.incidentId);
  if (ticket) lines.push(ticket);

  lines.push(SEP, advice);
  return lines.join('\n');
}

/** Port of format_image_report. */
export function formatImageReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  const category = scan.contentCategory || 'UNKNOWN';
  const layoutType = scan.image?.layoutType ?? 'GENERAL_IMAGE';
  const [header, statusLabel, advice] = verdictBlock(scan.verdict, 'IMAGE', category);

  const lines: string[] = [
    header,
    '_VisiKartika Shield — Forensik Poster, Screenshot & QR_',
    SEP,
    `🛡️ *Status Putusan*: *${statusLabel}*`,
    `🗂️ *Jenis Konten*: \`${layoutType}\``,
    `📈 *Skor Risiko Total*: *${fixed(scan.scores.total)} / 100*`,
    `   ├─ Kemiripan Visual: \`${fixed(scan.scores.visual)}%\``,
    `   ├─ Anomali Konten/OCR/QR: \`${fixed(scan.scores.dom)}%\``,
    `   └─ Telemetri Domain: \`${fixed(scan.scores.domain ?? 0)}%\``,
  ];

  if (scan.impersonatedTarget && scan.verdict !== 'SAFE') {
    lines.push(`🎭 *Indikasi Penyamaran*: ${scan.impersonatedTarget}`);
  }
  if (scan.detectedLogos.length > 0) {
    const brands = scan.detectedLogos
      .slice(0, 2)
      .map((l) => `${l.brandName} (${fixed(l.confidence, 0)}%)`)
      .join(', ');
    lines.push(`🎖️ *Atribut Militer Terdeteksi*: ${brands}`);
  }

  const qrCodes = scan.image?.qrCodes ?? [];
  const extractedUrls = scan.image?.extractedUrls ?? [];
  if (qrCodes.length > 0) {
    lines.push(`📷 *Isi QR Code*: ${qrCodes.slice(0, 2).map((q) => `\`${q.payload}\``).join(', ')}`);
  } else if (extractedUrls.length > 0) {
    lines.push(`🔗 *Tautan Terbaca (OCR)*: ${extractedUrls.slice(0, 2).map((u) => `\`${u}\``).join(', ')}`);
  }

  if (scan.forensicReasons.length > 0) {
    lines.push('\n🔍 *Temuan Forensik Utama*:');
    lines.push(...scan.forensicReasons.slice(0, 3).map((r) => `  • ${r}`));
  }
  if (includeEvidenceLink && isPublicEvidenceUrl(scan.annotatedUrl)) {
    lines.push(`\n🖼️ *Bukti Bounding Box*: ${scan.annotatedUrl}`);
  }
  const ticket = ticketLine(scan.incidentId);
  if (ticket) lines.push(ticket);

  lines.push(SEP, advice);
  return lines.join('\n');
}

/** Dispatch on the scan kind, as process_inbound does. */
export function formatReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  return scan.kind === 'IMAGE'
    ? formatImageReport(scan, includeEvidenceLink)
    : formatUrlReport(scan, includeEvidenceLink);
}
