/**
 * Display helpers. Indonesian locale, WIB timestamps, and defanged indicators.
 */

const WIB = 'Asia/Jakarta';

const dateTimeWib = new Intl.DateTimeFormat('id-ID', {
  timeZone: WIB,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const timeWib = new Intl.DateTimeFormat('id-ID', {
  timeZone: WIB,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Full timestamp in WIB, e.g. "03 Nov 2026, 11.07.01 WIB". */
export function formatWib(iso: string): string {
  return `${dateTimeWib.format(new Date(iso))} WIB`;
}

export function formatTimeWib(iso: string): string {
  return `${timeWib.format(new Date(iso))} WIB`;
}

/**
 * Both zones side by side. Forensic convention, and it removes any ambiguity
 * about when an incident actually happened.
 */
export function formatForensicTimestamp(iso: string): string {
  const utc = new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  return `${formatWib(iso)}  /  ${utc}`;
}

/** Compact relative age for feed rows: "baru saja", "3 mnt", "2 jam", "5 hr". */
export function formatAge(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'baru saja';
  if (sec < 60) return `${sec} dtk`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam`;
  return `${Math.floor(hr / 24)} hr`;
}

/** One decimal, Indonesian comma separator. */
export function formatScore(value: number): string {
  return value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toLocaleString('id-ID', { maximumFractionDigits: 2 })} dtk`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Defang an indicator so it cannot be clicked or auto-linked:
 *   https://evil.com/x -> hxxps://evil[.]com/x
 *
 * A live link to a phishing host on a SOC dashboard is the kind of detail a
 * cyber jury notices immediately, so indicators render as text with this
 * toggle rather than as anchors.
 */
export function defang(value: string): string {
  return value
    .replace(/^http:/i, 'hxxp:')
    .replace(/^https:/i, 'hxxps:')
    .replace(/\./g, '[.]')
    .replace(/^(hxxps?)\[\.\]/i, '$1:');
}

/** Reverse of defang, for copying a real value to the clipboard deliberately. */
export function refang(value: string): string {
  return value
    .replace(/\[\.\]/g, '.')
    .replace(/^hxxp:/i, 'http:')
    .replace(/^hxxps:/i, 'https:');
}

/** Middle-truncate a long URL while keeping both ends legible. */
export function truncateMiddle(value: string, max = 72): string {
  if (value.length <= max) return value;
  const keep = Math.floor((max - 1) / 2);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/**
 * An image scan with no URL stores a synthetic label instead of one. Render it
 * as something readable rather than leaking the raw "[IMAGE:...]" form.
 */
export function describeTarget(submittedUrl: string | null): string {
  if (!submittedUrl) return '(tanpa target)';
  const m = /^\[IMAGE:([^\]]*)\]\s*(.*)$/.exec(submittedUrl);
  if (!m) return submittedUrl;
  const layout = (m[1] || 'GAMBAR').trim();
  const source = (m[2] || '').trim();
  return source ? `Gambar (${layout}) — ${source}` : `Gambar (${layout})`;
}

/** Clipboard write that degrades gracefully outside a secure context. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through: blocked permission, or a non-secure origin such as a LAN IP.
  }
  return false;
}
