/**
 * Reporter unit -> approximate map coordinates.
 *
 * IMPORTANT, and stated in the UI: this maps where a report ORIGINATED, not
 * where an attacker is. The engine stores no attacker geolocation, and claiming
 * otherwise on a command map would be misleading.
 *
 * Coordinates are the HQ city of each command, accurate to the city, not the
 * building. That precision is appropriate for a report-origin overview.
 *
 * Verified against live data on 2026-11-03: every existing incident carries a
 * reporter_unit like "WA Openwa (Denindra)" or "Uji Juri - Quishing Poster",
 * none of which match this table. Misses are an expected majority, must be
 * surfaced in an "Asal tidak terpeta" list rather than dropped, and the seed
 * script plus the sandbox's unit <select> are what make the map meaningful.
 */

export interface UnitLocation {
  /** Canonical display name. */
  label: string;
  lat: number;
  lon: number;
  /** Short form for dense marker labels. */
  short: string;
}

/**
 * Keys are normalized (see `normalizeUnitKey`). Order is roughly west to east.
 */
export const UNIT_LOCATIONS: Readonly<Record<string, UnitLocation>> = {
  iskandarmuda: { label: 'Kodam Iskandar Muda', short: 'IM', lat: 5.5483, lon: 95.3238 },
  ibukitbarisan: { label: 'Kodam I/Bukit Barisan', short: 'I/BB', lat: 3.5952, lon: 98.6722 },
  iisriwijaya: { label: 'Kodam II/Sriwijaya', short: 'II/SWJ', lat: -2.9761, lon: 104.7754 },
  xiitanjungpura: { label: 'Kodam XII/Tanjungpura', short: 'XII/TPR', lat: -0.0263, lon: 109.3425 },
  jayajayakarta: { label: 'Kodam Jaya/Jayakarta', short: 'JAYA', lat: -6.2088, lon: 106.8456 },
  iiisiliwangi: { label: 'Kodam III/Siliwangi', short: 'III/SLW', lat: -6.9175, lon: 107.6191 },
  ivdiponegoro: { label: 'Kodam IV/Diponegoro', short: 'IV/DIP', lat: -6.9932, lon: 110.4203 },
  vbrawijaya: { label: 'Kodam V/Brawijaya', short: 'V/BRW', lat: -7.2575, lon: 112.7521 },
  ixudayana: { label: 'Kodam IX/Udayana', short: 'IX/UDY', lat: -8.6705, lon: 115.2126 },
  vimulawarman: { label: 'Kodam VI/Mulawarman', short: 'VI/MLW', lat: -1.2379, lon: 116.8529 },
  xivhasanuddin: { label: 'Kodam XIV/Hasanuddin', short: 'XIV/HSN', lat: -5.1477, lon: 119.4327 },
  xiiimerdeka: { label: 'Kodam XIII/Merdeka', short: 'XIII/MDK', lat: 1.4748, lon: 124.8421 },
  xvipattimura: { label: 'Kodam XVI/Pattimura', short: 'XVI/PTM', lat: -3.6954, lon: 128.1814 },
  xviiikasuari: { label: 'Kodam XVIII/Kasuari', short: 'XVIII/KSR', lat: -0.8615, lon: 134.062 },
  xviicenderawasih: {
    label: 'Kodam XVII/Cenderawasih',
    short: 'XVII/CDW',
    lat: -2.5916,
    lon: 140.669,
  },

  // Central commands and training institutions.
  mabesad: { label: 'Mabesad', short: 'MABES', lat: -6.1754, lon: 106.8272 },
  pussiberad: { label: 'Pussiberad', short: 'PUSSIBER', lat: -6.2416, lon: 106.8186 },
  kemhan: { label: 'Kemhan RI', short: 'KEMHAN', lat: -6.1744, lon: 106.8294 },
  akmil: { label: 'Akmil Magelang', short: 'AKMIL', lat: -7.4698, lon: 110.2177 },
  seskoad: { label: 'Seskoad Bandung', short: 'SESKOAD', lat: -6.9034, lon: 107.6181 },
  secapaad: { label: 'Secapa AD Bandung', short: 'SECAPA', lat: -6.8915, lon: 107.5886 },
  poltekad: { label: 'Poltekad Malang', short: 'POLTEKAD', lat: -7.9666, lon: 112.6326 },
};

/**
 * Collapse a free-text reporter_unit to a lookup key.
 *
 * Strips the prefixes the engine actually emits ("WA Openwa (...)",
 * "WA Lapor Cepat (...)"), the KODAM/KOREM/KODIM words, roman-numeral
 * separators, and all punctuation and spacing — so "Kodam IV/Diponegoro",
 * "KODAM IV DIPONEGORO" and "iv-diponegoro" all land on the same key.
 */
export function normalizeUnitKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .toUpperCase()
    // Drop the WhatsApp channel wrapper and anything parenthesised.
    .replace(/\bWA\b\s+(OPENWA|LAPOR\s*CEPAT)\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(KODAM|KOREM|KODIM|KOMANDO|DAERAH|MILITER|SATUAN|JAJARAN)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '')
    .toLowerCase();
}

/** Resolve a reporter_unit to a location, or null when it cannot be mapped. */
export function locateUnit(reporterUnit: string | null | undefined): UnitLocation | null {
  const key = normalizeUnitKey(reporterUnit);
  if (key === '') return null;
  if (key in UNIT_LOCATIONS) return UNIT_LOCATIONS[key];
  // Allow partial matches so "ivdiponegorobandung" still resolves.
  for (const [k, v] of Object.entries(UNIT_LOCATIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

/** Options for the sandbox's reporter-unit picker, so demo scans always map. */
export const UNIT_OPTIONS: readonly string[] = Object.values(UNIT_LOCATIONS).map((u) => u.label);

/**
 * Deterministic small offset, so several units sharing a city (Mabesad,
 * Pussiberad, Kemhan and Kodam Jaya are all Jakarta) do not stack into one
 * unreadable marker. Deterministic, so markers never jitter between renders.
 */
export function jitterFor(key: string, amplitude = 0.35): { dLat: number; dLon: number } {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = (((h >> 9) & 0xff) / 255) * amplitude;
  return { dLat: Math.sin(a) * r, dLon: Math.cos(a) * r };
}
