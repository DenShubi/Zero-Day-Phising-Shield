/**
 * Deep-link query-parameter contract for the single-route `/` SOC console.
 *
 * All six operational panels live on `/` and synchronize with the URL query
 * string (`/?view=...&insiden=...&host=...`) via `useSearchParams` and
 * `router.replace`, keeping static export (`output: 'export'`) intact while
 * preserving shareable demo URLs and predictable browser history.
 */

export type PanelId =
  | 'komando'
  | 'pemindaian'
  | 'forensik'
  | 'audit'
  | 'mitigasi'
  | 'lapor-cepat';

export const DEFAULT_PANEL: PanelId = 'komando';

export const PANEL_IDS: readonly PanelId[] = [
  'komando',
  'pemindaian',
  'forensik',
  'audit',
  'mitigasi',
  'lapor-cepat',
] as const;

const ALIASES: Readonly<Record<string, PanelId>> = {
  komando: 'komando',
  command: 'komando',
  pemindaian: 'pemindaian',
  sandbox: 'pemindaian',
  scan: 'pemindaian',
  forensik: 'forensik',
  forensics: 'forensik',
  audit: 'audit',
  mitigasi: 'mitigasi',
  mitigation: 'mitigasi',
  'lapor-cepat': 'lapor-cepat',
  whatsapp: 'lapor-cepat',
};

export function parsePanelView(raw: string | null | undefined): PanelId {
  if (!raw) return DEFAULT_PANEL;
  const key = raw.trim().toLowerCase();
  return ALIASES[key] ?? DEFAULT_PANEL;
}

export interface PanelQuery {
  view: PanelId;
  /** Incident or scan identifier opened in the Forensik panel. */
  insiden: string | null;
  /** Hostname highlighted/pre-selected in the Mitigasi panel. */
  host: string | null;
}

export interface SearchParamsLike {
  get(name: string): string | null;
}

export function readPanelQuery(params: SearchParamsLike | null | undefined): PanelQuery {
  if (!params) {
    return { view: DEFAULT_PANEL, insiden: null, host: null };
  }
  const rawView = params.get('view');
  // Accept legacy `id` param as fallback so older bookmarks still resolve.
  const insiden = params.get('insiden') ?? params.get('id');
  const host = params.get('host');

  // If `insiden` is present without an explicit `view`, open Forensik directly.
  const view = rawView ? parsePanelView(rawView) : insiden ? 'forensik' : DEFAULT_PANEL;

  return {
    view,
    insiden: insiden && insiden.trim() !== '' ? insiden.trim() : null,
    host: host && host.trim() !== '' ? host.trim().toLowerCase() : null,
  };
}

export function buildPanelHref(
  view: PanelId,
  extra?: { insiden?: string | null; host?: string | null },
): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_PANEL) {
    qs.set('view', view);
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
