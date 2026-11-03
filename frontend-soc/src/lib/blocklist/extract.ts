/**
 * Turning incidents into indicators of compromise.
 *
 * The validation here is not ceremony. Many candidate hosts come from OCR, so
 * the raw input genuinely contains things like `tniad.mil.ld`, `tniad,mil.id`,
 * truncated strings and pure noise. Shipping those as blocklist entries would
 * put garbage into a resolver and would be the first thing a sharp reviewer
 * finds, so every candidate is validated and every indicator carries the
 * provenance that produced it.
 */

import type { NormalizedScan } from '../normalize';

/** Where an indicator came from, which determines how much to trust it. */
export type Provenance =
  | 'URL_FINAL'
  | 'REDIRECT_HOP'
  | 'FORM_ACTION'
  | 'EXTERNAL_DOMAIN'
  | 'QR_PAYLOAD'
  | 'OCR_TEXT';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  URL_FINAL: 'URL akhir',
  REDIRECT_HOP: 'Lompatan pengalihan',
  FORM_ACTION: 'Target formulir',
  EXTERNAL_DOMAIN: 'Domain eksternal',
  QR_PAYLOAD: 'Isi QR code',
  OCR_TEXT: 'Teks OCR',
};

/**
 * OCR output is the only source where the characters themselves may be wrong,
 * so those indicators start unselected and are badged in the UI.
 */
export const LOW_CONFIDENCE: ReadonlySet<Provenance> = new Set<Provenance>(['OCR_TEXT']);

export interface Ioc {
  host: string;
  provenance: Provenance;
  /** Verdict of the incident this came from. */
  verdict: NormalizedScan['verdict'];
  riskScore: number;
  incidentId: string | null;
  ticket: string | null;
  firstSeenIso: string;
  impersonatedTarget: string | null;
}

/* ------------------------------- validation ------------------------------- */

/** Hosts that must never reach a blocklist, whatever the engine saw. */
const NEVER_BLOCK = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
]);

const RESERVED_SUFFIXES = ['.local', '.internal', '.localdomain', '.lan', '.home.arpa', '.test', '.invalid', '.example'];

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrReservedIpv4(host: string): boolean {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export function isIpv4(host: string): boolean {
  return IPV4_RE.test(host);
}

export interface RejectedHost {
  raw: string;
  reason: string;
}

/**
 * Normalise and validate one candidate host.
 * Returns the cleaned host, or a reason it was rejected.
 */
export function validateHost(raw: string): { host: string } | { reason: string } {
  let value = raw.trim().toLowerCase();
  if (value === '') return { reason: 'kosong' };

  // Strip a scheme and anything after the authority.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0];
  // userinfo@host
  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);
  // host:port — but leave bracketed IPv6 alone, which we reject below anyway.
  if (!value.startsWith('[')) value = value.split(':')[0];
  value = value.replace(/\.+$/, '');

  if (value === '') return { reason: 'kosong setelah normalisasi' };
  if (value.startsWith('[')) {
    // An IPv6 literal is bracketed, but so is the engine's synthetic
    // "[IMAGE...]" label — reporting that as an IPv6 address would be wrong.
    return /^\[[0-9a-f:]+\]?$/.test(value)
      ? { reason: 'alamat IPv6 tidak didukung' }
      : { reason: 'bukan host (label sintetis)' };
  }
  if (NEVER_BLOCK.has(value)) return { reason: 'host lokal' };
  if (value.length > 253) return { reason: 'melebihi 253 karakter' };

  if (isIpv4(value)) {
    if (isPrivateOrReservedIpv4(value)) return { reason: 'IP privat/khusus' };
    return { host: value };
  }

  const labels = value.split('.');
  if (labels.length < 2) return { reason: 'bukan nama domain berkualifikasi' };
  for (const label of labels) {
    if (label.length === 0) return { reason: 'label kosong' };
    if (label.length > 63) return { reason: 'label melebihi 63 karakter' };
    // Catches OCR artefacts such as a comma read in place of a dot.
    if (!LABEL_RE.test(label)) return { reason: `karakter tidak sah pada '${label}'` };
  }

  const tld = labels[labels.length - 1];
  // A numeric TLD means the string was never a hostname.
  if (/^\d+$/.test(tld)) return { reason: 'TLD numerik' };
  if (tld.length < 2) return { reason: 'TLD terlalu pendek' };
  if (RESERVED_SUFFIXES.some((s) => value.endsWith(s))) return { reason: 'domain khusus/uji' };

  return { host: value };
}

/* ------------------------------- extraction ------------------------------- */

function push(
  out: Map<string, Ioc>,
  rejected: RejectedHost[],
  raw: string | null | undefined,
  provenance: Provenance,
  scan: NormalizedScan,
): void {
  if (!raw) return;
  const result = validateHost(raw);
  if ('reason' in result) {
    rejected.push({ raw, reason: result.reason });
    return;
  }

  const existing = out.get(result.host);
  // Keep the most trustworthy provenance and the highest risk seen for a host.
  if (existing) {
    if (LOW_CONFIDENCE.has(existing.provenance) && !LOW_CONFIDENCE.has(provenance)) {
      existing.provenance = provenance;
    }
    if (scan.scores.total > existing.riskScore) {
      existing.riskScore = scan.scores.total;
      existing.verdict = scan.verdict;
    }
    if (scan.createdAtMs < Date.parse(existing.firstSeenIso)) {
      existing.firstSeenIso = scan.createdAtIso;
    }
    return;
  }

  out.set(result.host, {
    host: result.host,
    provenance,
    verdict: scan.verdict,
    riskScore: scan.scores.total,
    incidentId: scan.incidentId,
    ticket: scan.ticket,
    firstSeenIso: scan.createdAtIso,
    impersonatedTarget: scan.impersonatedTarget,
  });
}

export interface ExtractResult {
  iocs: Ioc[];
  rejected: RejectedHost[];
}

/**
 * Collect indicators across incidents.
 *
 * A quishing poster often has no `submitted_url` at all — its only real
 * indicator is the host inside the decoded QR payload — so the QR and OCR
 * sources matter rather than being an afterthought.
 */
export function extractIocs(scans: readonly NormalizedScan[]): ExtractResult {
  const out = new Map<string, Ioc>();
  const rejected: RejectedHost[] = [];

  for (const scan of scans) {
    // A synthetic "[IMAGE...]" label is not a URL. validateHost would reject it
    // anyway, but skipping it keeps the rejection list free of noise the
    // operator cannot act on. Older rows use "[IMAGE]" without the colon.
    if (scan.submittedUrl && !scan.submittedUrl.startsWith('[IMAGE')) {
      push(out, rejected, scan.submittedUrl, 'URL_FINAL', scan);
    }
    push(out, rejected, scan.finalUrl, 'URL_FINAL', scan);

    if (scan.url) {
      for (const hop of scan.url.redirectChain) push(out, rejected, hop, 'REDIRECT_HOP', scan);
      for (const form of scan.url.forms) {
        push(out, rejected, form.resolvedAction ?? form.action, 'FORM_ACTION', scan);
      }
      for (const d of scan.url.externalDomains) push(out, rejected, d, 'EXTERNAL_DOMAIN', scan);
    }

    if (scan.image) {
      for (const qr of scan.image.qrCodes) push(out, rejected, qr.payload, 'QR_PAYLOAD', scan);
      for (const link of scan.image.extractedUrls) push(out, rejected, link, 'OCR_TEXT', scan);
    }
  }

  const iocs = [...out.values()].sort(
    (a, b) => b.riskScore - a.riskScore || a.host.localeCompare(b.host),
  );
  return { iocs, rejected };
}
