'use client';

/**
 * Mitigasi panel: indicator checkbox ledger on the left, one clear download CTA
 * per export format + live Geist Mono configuration preview on the right, and
 * ?host=<hostname> deep-linking from Forensik / Simulasi Lapor Cepat.
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

/** Lines shown in the rule preview before it hands off to Salin / Unduh. */
const PREVIEW_LINE_BUDGET = 5;

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
        /* Supabase / session incidents remain active even when Python engine is offline */
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

  const previewLines = useMemo(() => {
    if (!renderedPreview) return [];
    const body = renderedPreview
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^\s*[;#]/.test(line));
    const hostLines = body.filter((line) => chosen.some((ioc) => line.includes(ioc.host)));
    const lines = hostLines.length > 0 ? hostLines : body;
    return (lines.length > 0 ? lines : renderedPreview.trim().split('\n')).slice(
      0,
      PREVIEW_LINE_BUDGET,
    );
  }, [renderedPreview, chosen]);

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

  return (
    <section className="vk-panel-section">
      {/* Flush Architectural Header */}
      <header className="vk-page-header">
        <div>
          <div className="vk-kicker">{t.mitigation.sectionIndex}</div>
          <h1
            id="vk-main-heading"
            tabIndex={-1}
            className="mt-0.5 text-[1.25rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none sm:text-[1.375rem]"
          >
            {t.mitigation.title}
          </h1>
          <p className="mt-0.5 max-w-[66ch] text-[0.8125rem] leading-[1.45] text-[var(--muted-strong)]">
            {t.mitigation.subtitle}
          </p>
        </div>
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
          className="vk-btn vk-btn-primary h-9 shrink-0 px-3.5 text-[0.8125rem]"
        >
          <IconDownload size={14} />
          <span>{t.mitigation.ctaDownloadRules}</span>
        </button>
      </header>

      {/* Flush Controlled Export Notice Bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[0.75rem] text-[var(--muted-strong)] sm:px-5">
        <span className="shrink-0 text-[var(--verdict-suspicious)]" aria-hidden="true">
          <IconAlertTriangle size={14} />
        </span>
        <div>
          <strong className="font-semibold text-[var(--foreground)]">
            {t.mitigation.simulationNoticeTitle}:
          </strong>{' '}
          {t.mitigation.simulationNotice}
        </div>
      </div>

      {/* Main 12-Col Split Ledger: Validated IOC Table (Left 7) + Export Formats & Live Preview (Right 5) */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        {/* LEFT 7 COLUMNS: Validated IOC Checkbox Ledger */}
        <div className="flex min-h-0 min-w-0 flex-col bg-[var(--surface-1)] lg:col-span-7">
          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-0)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="vk-pane-label text-[var(--foreground)]">
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

            {/* Search & Verdict Filter Strip */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
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
                  className="h-8 w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)] pr-3 pl-8 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
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
                      className="rounded-[3px] border px-1.5 py-1 transition-colors"
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

          {/* Focused Host Banner when arriving from Forensik */}
          {focusedHost && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--accent-border)] bg-[var(--accent-tint)] px-4 py-2 text-[0.8125rem]">
              <span className="text-[var(--foreground)]">
                {t.mitigation.focusedHostBanner}{' '}
                <strong className="vk-mono text-[var(--accent-ink)]">{focusedHost}</strong>
              </span>
              <button
                type="button"
                onClick={() => router.replace(buildPanelHref('mitigasi'), { scroll: false })}
                className="text-[0.75rem] font-medium text-[var(--accent-ink)] underline hover:text-[var(--foreground)]"
              >
                {t.mitigation.clearFocusedHost}
              </button>
            </div>
          )}

          {/* Sticky-Header IOC Table */}
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
              <table className="w-full border-collapse text-[0.8125rem]">
                <caption id="vk-ioc-caption" className="visually-hidden">
                  {t.mitigation.iocTableCaption}
                </caption>
                <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-0)]">
                  <tr className="text-left">
                    <th scope="col" className="vk-pane-label w-10 px-3 py-2.5">
                      {t.mitigation.colInclude}
                    </th>
                    <th scope="col" className="vk-pane-label whitespace-nowrap px-3 py-2.5">
                      {t.mitigation.colHost}
                    </th>
                    <th scope="col" className="vk-pane-label whitespace-nowrap px-2.5 py-2.5">
                      {t.mitigation.colVerdict}
                    </th>
                    <th
                      scope="col"
                      className="vk-pane-label hidden whitespace-nowrap px-2.5 py-2.5 text-right xl:table-cell"
                    >
                      {t.mitigation.colScore}
                    </th>
                    <th scope="col" className="vk-pane-label hidden px-3 py-2.5 lg:table-cell">
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
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHost(ioc.host)}
                            aria-label={`${t.mitigation.includeHostAriaPrefix} ${ioc.host}`}
                            className="h-4 w-4 accent-[var(--accent-ink)]"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="vk-mono break-all text-[0.8125rem] font-medium text-[var(--foreground)]">
                            {ioc.host}
                          </div>
                          {ioc.ticket && (
                            <div className="vk-mono whitespace-nowrap text-[0.72rem] text-[var(--muted)]">
                              {ioc.ticket}
                            </div>
                          )}
                          {low && (
                            <div
                              className="mt-0.5 inline-flex items-center gap-1 text-[0.72rem] lg:hidden"
                              style={{ color: 'var(--verdict-suspicious)' }}
                            >
                              <IconAlertTriangle size={11} />
                              <span>{t.mitigation.lowConfidence}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5">
                          <VerdictBadge verdict={ioc.verdict} size="sm" />
                        </td>
                        <td className="vk-mono vk-tabular hidden px-2.5 py-2.5 text-right font-semibold text-[var(--foreground)] xl:table-cell">
                          {formatScore(ioc.riskScore)}
                        </td>
                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          <span className="text-[var(--muted-strong)]">
                            {PROVENANCE_LABEL[ioc.provenance]}
                          </span>
                          {low && (
                            <span
                              className="ml-1.5 inline-flex items-center gap-1 text-[0.72rem]"
                              style={{ color: 'var(--verdict-suspicious)' }}
                            >
                              <IconAlertTriangle size={11} />
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
                <ul className="vk-scroll mt-1.5 max-h-24 overflow-y-auto rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)] p-2">
                  {rejected.slice(0, 40).map((r, idx) => (
                    <li
                      key={`${r.raw}-${idx}`}
                      className="vk-mono text-[0.72rem] text-[var(--muted)]"
                    >
                      {r.raw}: {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* RIGHT 5 COLUMNS: Infrastructure Formats + Live Geist Mono Rule Preview */}
        <aside className="flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] bg-[var(--surface-0)] lg:col-span-5">
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="vk-pane-label text-[var(--foreground)]">{t.mitigation.formatsTitle}</h2>

            <div className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-y-auto pr-0.5">
              <ul className="divide-y divide-[var(--border-subtle)] rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)]">
                {FORMATS.map((f) => {
                  const isPreviewed = previewFormat === f.id;
                  return (
                    <li
                      key={f.id}
                      className="flex min-w-0 items-center justify-between gap-2.5 px-3 py-2 transition-colors"
                      style={{
                        background: isPreviewed ? 'var(--accent-tint)' : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewFormat(f.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
                          {f.label}
                        </div>
                        {isPreviewed && (
                          <div className="mt-0.5 text-[0.75rem] leading-snug text-[var(--muted)]">
                            {f.description}
                          </div>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={chosen.length === 0}
                        onClick={() => downloadText(f.filename, f.mime, renderFormat(f.id, chosen))}
                        className="vk-btn vk-btn-primary h-7 shrink-0 px-2.5 text-[0.75rem]"
                      >
                        <IconDownload size={13} />
                        <span>{t.mitigation.download}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Live Geist Mono Rule Preview */}
          <div className="flex min-w-0 shrink-0 flex-col p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="vk-mono min-w-0 break-all text-[0.75rem] font-semibold text-[var(--foreground)]">
                {t.mitigation.previewHeaderPrefix} {activeFormatMeta.filename}
              </h3>
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={copyRules}
                className="vk-btn vk-btn-secondary h-7 shrink-0 px-2.5 text-[0.75rem]"
              >
                {copiedPreview ? <IconCheck size={12} /> : <IconCopy size={12} />}
                <span>{copiedPreview ? t.common.copied : t.mitigation.copyCode}</span>
              </button>
            </div>

            <div
              aria-label={`${t.mitigation.previewHeaderPrefix} ${activeFormatMeta.filename}`}
              className="vk-mono mt-2 h-[7.5rem] w-full min-w-0 overflow-hidden rounded-[3px] border border-[var(--border-strong)] bg-[var(--canvas)] p-3 text-[0.75rem] leading-[1.21875rem] text-[var(--muted-strong)] xl:h-[12.5rem]"
            >
              {chosen.length === 0 ? (
                <p className="leading-snug">{t.mitigation.emptyIocs}</p>
              ) : (
                previewLines.map((line, i) => (
                  <div
                    key={`${i}-${line}`}
                    className={
                      i >= 2 ? 'hidden line-clamp-2 break-all xl:block' : 'line-clamp-2 break-all'
                    }
                  >
                    {line || '\u00a0'}
                  </div>
                ))
              )}
            </div>

            {previewLines.length > 2 && (
              <p className="mt-1.5 text-[0.72rem] text-[var(--muted)]">
                {t.mitigation.previewTruncatedNote}
              </p>
            )}

            <div className="mt-1.5 text-[0.72rem] text-[var(--muted)]">
              {t.mitigation.localGenNotePrefix} {chosen.length} {t.mitigation.localGenNoteSuffix}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
