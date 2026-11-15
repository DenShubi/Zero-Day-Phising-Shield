/**
 * TypeScript port of the bot's reply formatting (Option 2: SOC Ticket Format).
 *
 * Mirrors app/wa_triage.py:
 *   LAYOUT_LABELS        lines 175-180
 *   _verdict_block       lines 234-303
 *   _is_public_evidence_url  line 306
 *   _ticket_line         line 310
 *   format_url_report    lines 316-349
 *   format_image_report  lines 352-391
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

export const LAYOUT_LABELS: Record<string, string> = {
  POSTER_OR_BANNER: 'Poster / Selebaran',
  MOBILE_SCREENSHOT: 'Tangkapan Layar HP',
  WEB_SCREENSHOT: 'Tangkapan Layar Web',
  GENERAL_IMAGE: 'Gambar Umum',
};

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
          '*Putusan: BERBAHAYA (Gambar Penipuan Terdeteksi)*',
          'BERBAHAYA',
          'Saran:\n' +
            'Jangan memindai kode QR, mengunduh file `.apk`, atau mengisi PIN, OTP, maupun kata sandi dari gambar ini. Bukti temuan telah diteruskan ke SOC untuk ditindaklanjuti.',
        ];
      }
      return [
        '*Putusan: BERBAHAYA (Poster / QR Palsu Terdeteksi)*',
        'BERBAHAYA',
        'Saran:\n' +
          'Jangan memindai kode QR, menghubungi nomor pada gambar, atau membuka tautan di luar domain resmi `.mil.id`. Bukti temuan telah diteruskan ke SOC untuk pemblokiran.',
      ];
    }
    if (contentCategory === 'GENERIC_PHISHING') {
      return [
        '*Putusan: BERBAHAYA (Situs Phishing Terdeteksi)*',
        'BERBAHAYA',
        'Saran:\n' +
          'Jangan mengisi kata sandi, PIN, kode OTP, atau data pribadi pada halaman ini.',
      ];
    }
    return [
      '*Putusan: BERBAHAYA (Phishing Terdeteksi)*',
      'BERBAHAYA',
      'Saran:\n' +
        'Jangan mengisi NRP, NIK, kata sandi, atau kode OTP pada halaman ini, dan jangan meneruskan tautan ke grup satuan atau keluarga. Domain telah diteruskan ke SOC untuk pemblokiran.',
    ];
  }

  if (verdict === 'SUSPICIOUS') {
    if (kind === 'IMAGE') {
      return [
        '*Putusan: WASPADA (Gambar Mencurigakan)*',
        'MENCURIGAKAN',
        'Saran:\n' +
          'Gambar ini memuat atribut atau tautan yang belum terverifikasi. Pastikan informasi hanya berasal dari domain resmi `.mil.id` (ketik *portal* untuk melihat daftar).',
      ];
    }
    return [
      '*Putusan: WASPADA (Tautan Mencurigakan)*',
      'MENCURIGAKAN',
      'Saran:\n' +
        'Tautan ini memiliki anomali keamanan dan bukan portal resmi `.mil.id`. Hindari mengisi data pribadi atau kredensial kedinasan sebelum diverifikasi petugas siber satuan.',
    ];
  }

  if (kind === 'IMAGE') {
    if (contentCategory === 'OFFICIAL_MILITARY' || contentCategory === 'POSTER_OFFICIAL_MILITARY') {
      return [
        '*Putusan: AMAN (Publikasi Militer Resmi)*',
        'AMAN (Publikasi Resmi)',
        'Catatan:\n' +
          'Gambar memuat informasi resmi tanpa tautan mencurigakan maupun kode QR palsu.',
      ];
    }
    return [
      '*Putusan: AMAN (Gambar Umum)*',
      'AMAN (Konten Umum)',
      'Catatan:\n' +
        'Tidak ditemukan indikasi phishing, kode QR berbahaya, maupun penyalahgunaan atribut TNI AD pada gambar ini.',
    ];
  }

  if (contentCategory === 'OFFICIAL_MILITARY') {
    return [
      '*Putusan: AMAN (Portal Resmi)*',
      'AMAN (Portal Resmi .mil.id)',
      'Catatan:\n' +
        'Domain terdaftar sebagai portal resmi TNI AD / Kemhan RI.',
    ];
  }

  return [
    '*Putusan: AMAN (Situs Umum)*',
    'AMAN (Situs Umum Non-Kedinasan)',
    'Catatan:\n' +
      'Tidak ditemukan indikasi pencurian kredensial atau pemalsuan identitas militer. Tetap gunakan NRP dan akun Sisfopers hanya pada domain resmi `.mil.id`.',
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
  return seg ? `Tiket SOC  : \`#JB-${seg.toUpperCase()}\`` : null;
}

const fixed = (n: number, places = 1) => n.toFixed(places);

/** Port of format_url_report. */
export function formatUrlReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  const category =
    scan.contentCategory || (scan.url?.isOfficialMilDomain ? 'OFFICIAL_MILITARY' : 'UNKNOWN');
  const [header, statusLabel, advice] = verdictBlock(scan.verdict, 'URL', category);

  const lines: string[] = [header];
  const ticket = ticketLine(scan.incidentId);
  if (ticket) lines.push(ticket);

  lines.push(
    '',
    `Target     : ${scan.finalUrl ?? scan.submittedUrl ?? '-'}`,
    `Status     : ${statusLabel}`,
  );

  if (scan.impersonatedTarget && scan.verdict !== 'SAFE') {
    lines.push(`Meniru     : ${scan.impersonatedTarget}`);
  }
  if (scan.detectedLogos.length > 0) {
    const brands = scan.detectedLogos
      .slice(0, 2)
      .map((l) => `${l.brandName} (${fixed(l.confidence, 0)}%)`)
      .join(', ');
    lines.push(`Atribut    : ${brands}`);
  }

  lines.push(
    `Skor Risiko: ${fixed(scan.scores.total)} / 100`,
    `- Kemiripan tampilan : ${fixed(scan.scores.visual)}%`,
    `- Perilaku halaman   : ${fixed(scan.scores.dom)}%`,
    `- Reputasi domain    : ${fixed(scan.scores.domain ?? 0)}%`,
  );

  if (scan.forensicReasons.length > 0) {
    lines.push('\nAlasan:');
    lines.push(...scan.forensicReasons.slice(0, 3).map((r) => `- ${r}`));
  }
  if (includeEvidenceLink && isPublicEvidenceUrl(scan.annotatedUrl)) {
    lines.push(`\nBukti visual: ${scan.annotatedUrl}`);
  }

  lines.push('', advice);
  return lines.join('\n');
}

/** Port of format_image_report. */
export function formatImageReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  const category = scan.contentCategory || 'UNKNOWN';
  const rawLayout = scan.image?.layoutType ?? 'GENERAL_IMAGE';
  const layoutLabel = LAYOUT_LABELS[rawLayout] ?? rawLayout;
  const [header, statusLabel, advice] = verdictBlock(scan.verdict, 'IMAGE', category);

  const lines: string[] = [header];
  const ticket = ticketLine(scan.incidentId);
  if (ticket) lines.push(ticket);

  lines.push(
    '',
    `Jenis      : ${layoutLabel}`,
    `Status     : ${statusLabel}`,
  );

  if (scan.impersonatedTarget && scan.verdict !== 'SAFE') {
    lines.push(`Meniru     : ${scan.impersonatedTarget}`);
  }
  if (scan.detectedLogos.length > 0) {
    const brands = scan.detectedLogos
      .slice(0, 2)
      .map((l) => `${l.brandName} (${fixed(l.confidence, 0)}%)`)
      .join(', ');
    lines.push(`Atribut    : ${brands}`);
  }

  const qrCodes = scan.image?.qrCodes ?? [];
  const extractedUrls = scan.image?.extractedUrls ?? [];
  if (qrCodes.length > 0) {
    lines.push(`Isi QR     : ${qrCodes.slice(0, 2).map((q) => `\`${q.payload}\``).join(', ')}`);
  } else if (extractedUrls.length > 0) {
    lines.push(`Tautan OCR : ${extractedUrls.slice(0, 2).map((u) => `\`${u}\``).join(', ')}`);
  }

  lines.push(
    `Skor Risiko: ${fixed(scan.scores.total)} / 100`,
    `- Kemiripan tampilan : ${fixed(scan.scores.visual)}%`,
    `- Konten & kode QR   : ${fixed(scan.scores.dom)}%`,
    `- Reputasi domain    : ${fixed(scan.scores.domain ?? 0)}%`,
  );

  if (scan.forensicReasons.length > 0) {
    lines.push('\nAlasan:');
    lines.push(...scan.forensicReasons.slice(0, 3).map((r) => `- ${r}`));
  }
  if (includeEvidenceLink && isPublicEvidenceUrl(scan.annotatedUrl)) {
    lines.push(`\nBukti visual: ${scan.annotatedUrl}`);
  }

  lines.push('', advice);
  return lines.join('\n');
}

/** Dispatch on the scan kind, as process_inbound does. */
export function formatReport(scan: NormalizedScan, includeEvidenceLink = true): string {
  return scan.kind === 'IMAGE'
    ? formatImageReport(scan, includeEvidenceLink)
    : formatUrlReport(scan, includeEvidenceLink);
}
