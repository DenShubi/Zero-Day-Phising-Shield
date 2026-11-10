'use client';

/**
 * Halaman Daftar Blokir Domain:
 * - Kiri (6 kolom): Daftar domain berbahaya dengan kotak centang
 * - Kanan (6 kolom): Pilihan format konfigurasi dan pratinjau kode siap unduh/salin
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getIncidents } from '@/lib/api/endpoints';
import {
  LOW_CONFIDENCE,
  PROVENANCE_LABEL,
  extractIocs,
} from '@/lib/blocklist/extract';
import { FORMATS, downloadText, renderFormat, type FormatId } from '@/lib/blocklist/formats';
import { formatScore } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { VERDICT_ORDER, type Verdict } from '@/lib/verdict';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconSearch,
} from '@/components/ui/icons';

type BulkMode = 'auto' | 'all' | 'none';

const TERMINAL_LINE_LIMIT = 80;

export function MitigationPanel({
  incidents,
  focusedHost,
}: {
  incidents: readonly NormalizedScan[];
  focusedHost: string | null;
}) {
  const router = useRouter();
  const [engineScans, setEngineScans] = useState<NormalizedScan[]>([]);
  const [userVerdicts, setUserVerdicts] = useState<ReadonlySet<Verdict>>(
    () => new Set<Verdict>(['CRITICAL_PHISHING', 'SUSPICIOUS']),
  );
  const [search, setSearch] = useState('');
  const [bulkMode, setBulkMode] = useState<BulkMode>('auto');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [previewFormat, setPreviewFormat] = useState<FormatId>('rpz');
  const [showRejected, setShowRejected] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void getIncidents(100, ac.signal)
      .then((rows) => {
        if (!ac.signal.aborted) setEngineScans(rows);
      })
      .catch(() => {
        /* Tetap menggunakan data yang ada */
      });
    return () => ac.abort();
  }, []);

  const mergedScans = useMemo(() => {
    const map = new Map<string, NormalizedScan>();
    for (const s of incidents) {
      map.set(s.incidentId ?? s.scanId, s);
    }
    for (const s of engineScans) {
      const key = s.incidentId ?? s.scanId;
      if (!map.has(key)) map.set(key, s);
    }
    return Array.from(map.values());
  }, [incidents, engineScans]);

  const { iocs, rejected } = useMemo(() => extractIocs(mergedScans), [mergedScans]);

  const normalizedFocus = focusedHost ? focusedHost.toLowerCase() : null;

  const minVerdicts = useMemo(() => {
    if (!normalizedFocus) return userVerdicts;
    const match = iocs.find((i) => i.host === normalizedFocus);
    if (!match || userVerdicts.has(match.verdict)) return userVerdicts;
    const next = new Set(userVerdicts);
    next.add(match.verdict);
    return next;
  }, [userVerdicts, normalizedFocus, iocs]);

  const verdictFiltered = useMemo(
    () => iocs.filter((i) => minVerdicts.has(i.verdict)),
    [iocs, minVerdicts],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return verdictFiltered;
    return verdictFiltered.filter(
      (i) =>
        i.host.toLowerCase().includes(q) ||
        (i.ticket && i.ticket.toLowerCase().includes(q)),
    );
  }, [verdictFiltered, search]);

  const selected = useMemo(() => {
    const out = new Set<string>();
    for (const ioc of verdictFiltered) {
      const explicit = overrides.get(ioc.host);
      if (explicit !== undefined) {
        if (explicit) out.add(ioc.host);
        continue;
      }
      if (bulkMode === 'all') {
        out.add(ioc.host);
      } else if (bulkMode === 'auto') {
        if (!LOW_CONFIDENCE.has(ioc.provenance) || ioc.host === normalizedFocus) {
          out.add(ioc.host);
        }
      }
    }
    return out;
  }, [verdictFiltered, overrides, bulkMode, normalizedFocus]);

  const chosen = useMemo(
    () => verdictFiltered.filter((i) => selected.has(i.host)),
    [verdictFiltered, selected],
  );

  const renderedPreview = useMemo(
    () => (chosen.length > 0 ? renderFormat(previewFormat, chosen) : ''),
    [previewFormat, chosen],
  );

  const allPreviewLines = useMemo(
    () => (renderedPreview ? renderedPreview.trimEnd().split('\n') : []),
    [renderedPreview],
  );

  const previewLines = useMemo(
    () => allPreviewLines.slice(0, TERMINAL_LINE_LIMIT),
    [allPreviewLines],
  );

  const toggleVerdict = (v: Verdict) => {
    setUserVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const toggleHost = (host: string) => {
    const nextChecked = !selected.has(host);
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(host, nextChecked);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === verdictFiltered.length) {
      setBulkMode('none');
      setOverrides(new Map());
    } else {
      setBulkMode('all');
      setOverrides(new Map());
    }
  };

  const activeFormatMeta = FORMATS.find((f) => f.id === previewFormat) ?? FORMATS[0];

  const copyRules = () => {
    if (!renderedPreview) return;
    void navigator.clipboard?.writeText(renderedPreview).then(() => {
      setCopiedPreview(true);
      setTimeout(() => setCopiedPreview(false), 1800);
    });
  };

  // Rendered as the blocklist half of the Respons panel, so it carries no page
  // header of its own - the segmented control above it already names it.
  return (
    <div className="vk-panel-section">
      {/* 2-Kolom Utama: Daftar Domain (6 Kolom) | Kode Konfigurasi (6 Kolom) */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        {/* KIRI: Daftar Domain */}
        <div className="flex min-h-0 min-w-0 flex-col bg-[var(--surface-1)] lg:col-span-6">
          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-0)] px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                {t.mitigation.iocTableTitle}{' '}
                <span className="vk-mono vk-tabular ml-1 text-[0.75rem] font-normal text-[var(--muted)]">
                  ({chosen.length} {t.mitigation.selectedCountMid} {verdictFiltered.length})
                </span>
              </h2>

              <button
                type="button"
                disabled={verdictFiltered.length === 0}
                onClick={toggleSelectAll}
                className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
              >
                {selected.size === verdictFiltered.length
                  ? t.mitigation.clearAll
                  : t.mitigation.selectAll}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[11rem] flex-1">
                <label htmlFor="vk-ioc-search" className="visually-hidden">
                  {t.mitigation.searchPlaceholder}
                </label>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--muted)]"
                >
                  <IconSearch size={13} />
                </span>
                <input
                  id="vk-ioc-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.mitigation.searchPlaceholder}
                  className="h-8 w-full rounded-[var(--r-md)] border border-[var(--border-strong)] bg-[var(--surface-1)] pr-2.5 pl-8 text-[0.78rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {VERDICT_ORDER.map((v) => {
                  const on = minVerdicts.has(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => toggleVerdict(v)}
                      aria-pressed={on}
                      className="rounded-[var(--r-sm)] border px-1.5 py-0.5 transition-colors"
                      style={{
                        borderColor: on ? 'var(--border-strong)' : 'var(--border)',
                        borderStyle: on ? 'solid' : 'dashed',
                        background: on ? 'var(--surface-2)' : 'transparent',
                      }}
                    >
                      <VerdictBadge verdict={v} size="sm" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {focusedHost && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--accent-border)] bg-[var(--accent-tint)] px-4 py-1.5 text-[0.78rem]">
              <span className="text-[var(--foreground)]">
                {t.mitigation.focusedHostBanner}{' '}
                <strong className="vk-mono text-[var(--accent-ink)]">{focusedHost}</strong>
              </span>
              <button
                type="button"
                onClick={() => router.replace(buildPanelHref('respons', { tab: 'blokir' }), { scroll: false })}
                className="text-[0.75rem] font-medium text-[var(--accent-ink)] underline hover:text-[var(--foreground)]"
              >
                {t.mitigation.clearFocusedHost}
              </button>
            </div>
          )}

          <div
            role="region"
            aria-labelledby="vk-ioc-caption"
            tabIndex={0}
            className="vk-scroll min-h-0 flex-1 overflow-auto"
          >
            {visible.length === 0 ? (
              <div className="p-6 text-center text-[0.8125rem] text-[var(--muted)]">
                {t.mitigation.emptyIocs}
              </div>
            ) : (
              <table className="w-full border-collapse text-[0.78rem]">
                <caption id="vk-ioc-caption" className="visually-hidden">
                  {t.mitigation.iocTableCaption}
                </caption>
                <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-0)]">
                  <tr className="text-left">
                    <th scope="col" className="vk-pane-label w-9 px-3 py-2">
                      {t.mitigation.colInclude}
                    </th>
                    <th scope="col" className="vk-pane-label whitespace-nowrap px-3 py-2">
                      {t.mitigation.colHost}
                    </th>
                    <th scope="col" className="vk-pane-label whitespace-nowrap px-2 py-2">
                      {t.mitigation.colVerdict}
                    </th>
                    <th
                      scope="col"
                      className="vk-pane-label whitespace-nowrap px-2 py-2 text-right"
                    >
                      {t.mitigation.colScore}
                    </th>
                    <th scope="col" className="vk-pane-label hidden px-3 py-2 xl:table-cell">
                      {t.mitigation.provenance}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {visible.map((ioc) => {
                    const low = LOW_CONFIDENCE.has(ioc.provenance);
                    const isFocused = Boolean(normalizedFocus && ioc.host === normalizedFocus);
                    const checked = selected.has(ioc.host);
                    return (
                      <tr
                        key={ioc.host}
                        onClick={() => toggleHost(ioc.host)}
                        className="cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                        style={isFocused ? { background: 'var(--accent-tint)' } : undefined}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHost(ioc.host)}
                            aria-label={`${t.mitigation.includeHostAriaPrefix} ${ioc.host}`}
                            className="h-3.5 w-3.5 accent-[var(--accent-ink)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="vk-mono break-all text-[0.78rem] font-medium text-[var(--foreground)]">
                            {ioc.host}
                          </div>
                          {ioc.ticket && (
                            <div className="vk-mono whitespace-nowrap text-[0.6875rem] text-[var(--muted)]">
                              {ioc.ticket}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <VerdictBadge verdict={ioc.verdict} size="sm" />
                        </td>
                        <td className="vk-mono vk-tabular px-2 py-2 text-right font-semibold text-[var(--foreground)]">
                          {formatScore(ioc.riskScore)}
                        </td>
                        <td className="hidden px-3 py-2 xl:table-cell">
                          <span className="text-[var(--muted-strong)]">
                            {PROVENANCE_LABEL[ioc.provenance]}
                          </span>
                          {low && (
                            <span
                              className="ml-1 inline-flex items-center gap-1 text-[0.6875rem]"
                              style={{ color: 'var(--verdict-suspicious)' }}
                            >
                              <IconAlertTriangle size={10} />
                              <span>{t.mitigation.lowConfidence}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {rejected.length > 0 && (
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-0)] px-4 py-2">
              <button
                type="button"
                onClick={() => setShowRejected((v) => !v)}
                className="text-[0.75rem] text-[var(--muted-strong)] underline hover:text-[var(--foreground)]"
              >
                {rejected.length} {t.mitigation.rejectedToggleSuffix}
              </button>
              {showRejected && (
                <ul className="vk-scroll mt-1.5 max-h-24 overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-1)] p-2">
                  {rejected.slice(0, 40).map((r, idx) => (
                    <li
                      key={`${r.raw}-${idx}`}
                      className="vk-mono text-[0.6875rem] text-[var(--muted)]"
                    >
                      {r.raw}: {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* KANAN: Pilihan Format & Pratinjau Kode */}
        <aside className="flex min-h-0 min-w-0 flex-col bg-[var(--surface-0)] lg:col-span-6">
          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-1)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                  {activeFormatMeta.label}
                </span>
                <span className="vk-mono ml-2 text-[0.75rem] text-[var(--accent-ink)]">
                  ({activeFormatMeta.filename})
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={copyRules}
                  className="vk-btn vk-btn-secondary h-8 px-3 text-[0.75rem]"
                >
                  {copiedPreview ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  <span>{copiedPreview ? t.common.copied : t.mitigation.copyCode}</span>
                </button>
                <button
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={() =>
                    downloadText(
                      activeFormatMeta.filename,
                      activeFormatMeta.mime,
                      renderFormat(previewFormat, chosen),
                    )
                  }
                  className="vk-btn vk-btn-primary h-8 px-3 text-[0.75rem]"
                >
                  <IconDownload size={13} />
                  <span>{t.mitigation.download}</span>
                </button>
              </div>
            </div>

            {/* Pilihan Format Ringkas */}
            <div
              role="tablist"
              aria-label={t.mitigation.formatsTitle}
              className="mt-2.5 flex flex-wrap gap-1"
            >
              {FORMATS.map((f) => {
                const isActive = previewFormat === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setPreviewFormat(f.id)}
                    data-active={isActive ? 'true' : undefined}
                    className="vk-chip h-7 text-[0.75rem]"
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            aria-label={`${t.mitigation.previewHeaderPrefix} ${activeFormatMeta.filename}`}
            className="vk-scroll min-h-0 flex-1 overflow-auto bg-[var(--canvas)] p-3"
          >
            {chosen.length === 0 ? (
              <div className="p-4 text-[0.78rem] text-[var(--muted)]">
                {t.mitigation.emptyIocs}
              </div>
            ) : (
              // The rule header stamps the time of generation, so the server
              // and client copies differ by milliseconds.
              <pre
                suppressHydrationWarning
                className="vk-mono whitespace-pre-wrap break-all text-[0.75rem] leading-[1.45] text-[var(--foreground)]"
              >
                {previewLines.join('\n')}
              </pre>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-[0.72rem] text-[var(--muted)]">
            <span className="vk-mono vk-tabular">
              {chosen.length} {t.mitigation.localGenNoteSuffix} · {allPreviewLines.length} baris
            </span>
            <span>{t.mitigation.simulationNoticeTitle}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
