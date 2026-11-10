/**
 * Deep-link query-parameter contract for the single-route `/` console.
 *
 * The console used to spread six thin panels across six tabs. Scanning and the
 * scan history are one job, and blocklist export and the WhatsApp intake are
 * both "what we do about it", so they were folded together. Four panels remain:
 *
 *   beranda   scan composer + history + inspector
 *   forensik  one incident in depth
 *   respons   blocklist export | WhatsApp intake  (`tab` selects the half)
 *   evaluasi  accuracy & latency benchmark
 *
 * Old links keep working: every retired view id is an alias, and the two that
 * became halves of `respons` also carry their `tab` across.
 */

export type PanelId = 'beranda' | 'forensik' | 'respons' | 'evaluasi';

/** Sub-view inside the Respons panel. */
export type ResponseTab = 'blokir' | 'wa';

export const DEFAULT_PANEL: PanelId = 'beranda';
export const DEFAULT_RESPONSE_TAB: ResponseTab = 'blokir';

export const PANEL_IDS: readonly PanelId[] = [
  'beranda',
  'forensik',
  'respons',
  'evaluasi',
] as const;

/** Retired ids that imply a specific half of the Respons panel. */
const TAB_ALIASES: Readonly<Record<string, ResponseTab>> = {
  mitigasi: 'blokir',
  mitigation: 'blokir',
  blokir: 'blokir',
  'lapor-cepat': 'wa',
  whatsapp: 'wa',
  wa: 'wa',
};

const ALIASES: Readonly<Record<string, PanelId>> = {
  beranda: 'beranda',
  komando: 'beranda',
  command: 'beranda',
  pemindaian: 'beranda',
  sandbox: 'beranda',
  scan: 'beranda',
  forensik: 'forensik',
  forensics: 'forensik',
  bukti: 'forensik',
  respons: 'respons',
  mitigasi: 'respons',
  mitigation: 'respons',
  'lapor-cepat': 'respons',
  whatsapp: 'respons',
  evaluasi: 'evaluasi',
  audit: 'evaluasi',
};

export function parsePanelView(raw: string | null | undefined): PanelId {
  if (!raw) return DEFAULT_PANEL;
  return ALIASES[raw.trim().toLowerCase()] ?? DEFAULT_PANEL;
}

export function parseResponseTab(raw: string | null | undefined): ResponseTab {
  if (!raw) return DEFAULT_RESPONSE_TAB;
  return TAB_ALIASES[raw.trim().toLowerCase()] ?? DEFAULT_RESPONSE_TAB;
}

export interface PanelQuery {
  view: PanelId;
  /** Which half of the Respons panel is open. */
  tab: ResponseTab;
  /** Incident or scan identifier opened in the Forensik panel. */
  insiden: string | null;
  /** Hostname highlighted/pre-selected in the blocklist. */
  host: string | null;
}

export interface SearchParamsLike {
  get(name: string): string | null;
}

export function readPanelQuery(params: SearchParamsLike | null | undefined): PanelQuery {
  if (!params) {
    return { view: DEFAULT_PANEL, tab: DEFAULT_RESPONSE_TAB, insiden: null, host: null };
  }

  const rawView = params.get('view');
  // Accept legacy `id` param as fallback so older bookmarks still resolve.
  const insiden = params.get('insiden') ?? params.get('id');
  const host = params.get('host');

  // `insiden` without an explicit view opens Forensik directly.
  const view = rawView ? parsePanelView(rawView) : insiden ? 'forensik' : DEFAULT_PANEL;

  // An explicit `tab` wins; otherwise a legacy view id picks the half it meant.
  const rawTab = params.get('tab');
  const tab = rawTab
    ? parseResponseTab(rawTab)
    : rawView
      ? parseResponseTab(rawView)
      : DEFAULT_RESPONSE_TAB;

  return {
    view,
    tab,
    insiden: insiden && insiden.trim() !== '' ? insiden.trim() : null,
    host: host && host.trim() !== '' ? host.trim().toLowerCase() : null,
  };
}

export function buildPanelHref(
  view: PanelId,
  extra?: { tab?: ResponseTab | null; insiden?: string | null; host?: string | null },
): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_PANEL) {
    qs.set('view', view);
  }
  if (view === 'respons' && extra?.tab && extra.tab !== DEFAULT_RESPONSE_TAB) {
    qs.set('tab', extra.tab);
  }
  if (extra?.insiden) {
    qs.set('insiden', extra.insiden);
  }
  if (extra?.host) {
    qs.set('host', extra.host);
  }
  const query = qs.toString();
  return query ? `/?${query}` : '/';
}
