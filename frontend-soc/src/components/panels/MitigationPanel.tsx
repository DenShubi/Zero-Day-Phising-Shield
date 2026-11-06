'use client';

/**
 * Mitigasi panel: indicator checkbox table on the left, one clear download CTA
 * per export format + live Geist Mono configuration preview on the right, and
 * seamless ?host=<hostname> deep-linking from Forensik / Simulasi Lapor Cepat.
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

  /**
   * The preview is bounded by whole lines rather than left to scroll: a box
   * that ends mid-glyph reads as broken on a projector, and the complete rule
   * set is one click away via Salin / Unduh. PREVIEW_LINE_BUDGET is what fits
   * the shortest panel height this layout produces.
   */
  const previewLines = useMemo(() => {
    if (!renderedPreview) return [];
    // Every format opens with a provenance banner - eight-odd comment lines
    // that wrap to the full height of this column, so the preview filled up
    // before a single rule appeared. The banner is boilerplate the operator
    // gets in the file; the rules are what they came here to check, so only
    // the rules are previewed. Download and Salin always emit renderFormat()'s
    // untouched output, banner included.
    const body = renderedPreview
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^\s*[;#]/.test(line));
    // Narrower still: the lines that name a chosen host. What is left of an
    // RPZ file after the banner is mostly a wrapped SOA record - true to the
    // format and useless to an operator checking which domains are about to
    // be sinkholed. These lines are short enough to read at a glance.
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
      {/* Title Row */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.mitigation.title}
          </h1>
          <p className="mt-0.5 max-w-[66ch] text-[0.875rem] text-[var(--muted-strong)]">
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
          className="vk-btn vk-btn-primary h-9 px-3.5 text-[0.875rem]"
        >
          <IconDownload size={15} />
          <span>{t.mitigation.ctaDownloadRules}</span>
        </button>
      </div>

      <div data-ui="console-workspace" className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Unmissable but Calm Simulation Notice Callout */}
        <div className="flex shrink-0 items-center gap-2.5 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
          <span className="shrink-0 text-[var(--verdict-suspicious)]">
            <IconAlertTriangle size={15} />
          </span>
          <div>
            <strong className="font-semibold text-[var(--foreground)]">
              {t.mitigation.simulationNoticeTitle}:
            </strong>{' '}
            {t.mitigation.simulationNotice}
          </div>
        </div>

        {/* Main 12-Col Bento: IOC Checkbox Table (Left 7) + Export Formats & Live Preview (Right 5) */}
        <div className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
          {/* LEFT 7 COLUMNS: Validated IOC Checkbox Table */}
          <div className="vk-bento flex min-h-0 min-w-0 flex-col p-4 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                {t.mitigation.iocTableTitle}{' '}
                <span className="vk-mono vk-tabular text-[0.875rem] font-normal text-[var(--muted)]">
                  ({chosen.length} {t.mitigation.selectedCountMid} {verdictFiltered.length})
                </span>
              </h3>

            <button
              type="button"
              disabled={verdictFiltered.length === 0}
              onClick={toggleSelectAll}
              className="vk-btn vk-btn-secondary h-8 px-2.5 text-[0.8125rem]"
            >
              {selected.size === verdictFiltered.length
                ? t.mitigation.clearAll
                : t.mitigation.selectAll}
            </button>
          </div>

          {/* Search & Verdict Filter Strip */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--muted)]">
                <IconSearch size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.mitigation.searchPlaceholder}
                aria-label={t.mitigation.searchPlaceholder}
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] pr-3 pl-8 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--ink-disabled)]"
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
                    /* The off state is carried by the frame, not by opacity:
                       dimming the badge to 0.45 dropped SAFE green to 2.55:1
                       against the panel, under the 4.5:1 this UI holds itself
                       to. A dashed, unfilled frame reads as "off" at full
                       legibility, and aria-pressed states it for assistive
                       tech. */
                    className="rounded-md border px-1.5 py-1 transition-colors"
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

          {/* Focused Host Banner when arriving from Forensik */}
          {focusedHost && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-tint)] px-3 py-1.5 text-[0.8125rem]">
              <span className="text-[var(--foreground)]">
                {t.mitigation.focusedHostBanner}{' '}
                <strong className="vk-mono text-[var(--accent-ink)]">{focusedHost}</strong>
              </span>
              <button
                type="button"
                onClick={() => router.replace(buildPanelHref('mitigasi'), { scroll: false })}
                className="text-[var(--accent-ink)] underline hover:text-[var(--foreground)]"
              >
                {t.mitigation.clearFocusedHost}
              </button>
            </div>
          )}

          {/* Sticky-Header IOC Table */}
          <div className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)]">
            {visible.length === 0 ? (
              <div className="p-6 text-center text-[0.875rem] text-[var(--muted)]">
                {t.mitigation.emptyIocs}
              </div>
            ) : (
              /* Five columns, not six: the ticket rides under its host rather
                 than holding an axis of its own, and provenance — the one
                 secondary column — drops below xl. Sideways scrolling is not a
                 fix here; a table a demo operator has to drag is a table that
                 does not fit. */
              <table className="w-full border-collapse text-[0.8125rem]">
                <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="w-9 px-2.5 py-2 font-medium text-[var(--muted)]">
                      {t.mitigation.colInclude}
                    </th>
                    <th className="px-2.5 py-2 font-medium whitespace-nowrap text-[var(--muted)]">
                      {t.mitigation.colHost}
                    </th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap text-[var(--muted)]">
                      {t.mitigation.colVerdict}
                    </th>
                    <th className="hidden px-2 py-2 text-right font-medium whitespace-nowrap text-[var(--muted)] xl:table-cell">
                      {t.mitigation.colScore}
                    </th>
                    <th className="hidden px-2 py-2 font-medium text-[var(--muted)] lg:table-cell">
                      {t.mitigation.provenance}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((ioc) => {
                    const low = LOW_CONFIDENCE.has(ioc.provenance);
                    const isFocused = Boolean(normalizedFocus && ioc.host === normalizedFocus);
                    const checked = selected.has(ioc.host);
                    return (
                      <tr
                        key={ioc.host}
                        onClick={() => toggleHost(ioc.host)}
                        className="cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-0 hover:bg-[var(--surface-2)]"
                        style={isFocused ? { background: 'var(--accent-tint)' } : undefined}
                      >
                        <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHost(ioc.host)}
                            aria-label={`${t.mitigation.includeHostAriaPrefix} ${ioc.host}`}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="vk-mono font-medium break-all text-[var(--foreground)]">
                            {ioc.host}
                          </div>
                          {ioc.ticket && (
                            <div className="vk-mono text-[0.75rem] whitespace-nowrap text-[var(--muted)]">
                              {ioc.ticket}
                            </div>
                          )}
                          {/* Below lg the provenance column is gone, so the
                              "needs a human look" flag rides with the host
                              instead of disappearing with it. */}
                          {low && (
                            <div
                              className="mt-0.5 inline-flex items-center gap-1 text-[0.75rem] lg:hidden"
                              style={{ color: 'var(--verdict-suspicious)' }}
                            >
                              <IconAlertTriangle size={11} />
                              <span>{t.mitigation.lowConfidence}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <VerdictBadge verdict={ioc.verdict} size="sm" />
                        </td>
                        {/* Score drops below xl, not provenance: the verdict
                            badge already carries severity, while provenance is
                            what tells an operator an indicator came from OCR
                            and still needs a human look before it reaches a
                            resolver. */}
                        <td className="vk-mono vk-tabular hidden px-2 py-2 text-right font-semibold text-[var(--foreground)] xl:table-cell">
                          {formatScore(ioc.riskScore)}
                        </td>
                        <td className="hidden px-2 py-2 lg:table-cell">
                          <span className="text-[var(--muted-strong)]">
                            {PROVENANCE_LABEL[ioc.provenance]}
                          </span>
                          {/* No outline here: a bordered pill beside real
                              buttons reads as a third button style on this
                              screen. Icon + amber text carries the same
                              warning without pretending to be clickable. */}
                          {low && (
                            <span
                              className="ml-1.5 inline-flex items-center gap-1 text-[0.75rem]"
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
            <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2">
              <button
                type="button"
                onClick={() => setShowRejected((v) => !v)}
                className="text-[0.8125rem] text-[var(--muted-strong)] underline hover:text-[var(--foreground)]"
              >
                {rejected.length} {t.mitigation.rejectedToggleSuffix}
              </button>
              {showRejected && (
                <ul className="vk-scroll mt-1.5 max-h-24 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2">
                  {rejected.slice(0, 40).map((r, idx) => (
                    <li
                      key={`${r.raw}-${idx}`}
                      className="vk-mono text-[0.75rem] text-[var(--muted)]"
                    >
                      {r.raw} — {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          </div>

          {/* RIGHT 5 COLUMNS: One Clear Download Action per Format + Live Code Preview */}
          <div className="vk-bento flex min-h-0 min-w-0 flex-col p-4 lg:col-span-5">
            <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {t.mitigation.formatsTitle}
            </h3>

          <div className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-y-auto pr-0.5">
            <ul className="flex flex-col gap-2">
              {FORMATS.map((f) => {
                const isPreviewed = previewFormat === f.id;
                return (
                  <li
                    key={f.id}
                    className="flex min-w-0 items-center justify-between gap-2.5 rounded-lg border px-3 py-2 transition-colors"
                    style={{
                      borderColor: isPreviewed ? 'var(--accent-border)' : 'var(--border)',
                      background: isPreviewed ? 'var(--accent-tint)' : 'var(--surface-2)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewFormat(f.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                        {f.label}
                      </div>
                      {/* Only the previewed format explains itself. Nine
                          descriptions stacked in this column either truncate
                          to nothing useful or push the list past its own
                          scroll box; one full description, on the row the
                          operator is actually looking at, says more. */}
                      {isPreviewed && (
                        <div className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--muted)]">
                          {f.description}
                        </div>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={chosen.length === 0}
                      onClick={() => downloadText(f.filename, f.mime, renderFormat(f.id, chosen))}
                      className="vk-btn vk-btn-primary h-8 shrink-0 px-3 text-[0.8125rem]"
                    >
                      <IconDownload size={14} />
                      <span>{t.mitigation.download}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Live Geist Mono Rule Preview */}
          <div className="mt-3 flex min-w-0 shrink-0 flex-col border-t border-[var(--border-subtle)] pt-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="min-w-0 text-[0.8125rem] leading-snug font-medium tracking-[0.02em] break-all text-[var(--muted-strong)]">
                {t.mitigation.previewHeaderPrefix} {activeFormatMeta.filename}
              </h4>
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={copyRules}
                className="vk-btn vk-btn-secondary h-7 shrink-0 px-2.5 text-[0.8125rem]"
              >
                {copiedPreview ? <IconCheck size={13} /> : <IconCopy size={13} />}
                <span>{copiedPreview ? t.common.copied : t.mitigation.copyCode}</span>
              </button>
            </div>

            {/* Fixed height, and every rule is budgeted at two wrapped lines,
                so the box holds exactly what it shows - two rules below xl,
                five above - at any column width. Wrapping without that budget
                made the visible line count depend on the width, and the box
                ended mid-rule at some viewport every time. */}
            <div
              aria-label={`${t.mitigation.previewHeaderPrefix} ${activeFormatMeta.filename}`}
              className="vk-mono mt-2 h-[7.5rem] w-full min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-3 text-[0.75rem] leading-[1.21875rem] text-[var(--muted-strong)] xl:h-[13.75rem]"
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
                    {line || ' '}
                  </div>
                ))
              )}
            </div>

            {previewLines.length > 2 && (
              <p className="mt-1.5 text-[0.75rem] text-[var(--muted)]">
                {t.mitigation.previewTruncatedNote}
              </p>
            )}

            <div className="mt-2 text-[0.75rem] text-[var(--muted)]">
              {t.mitigation.localGenNotePrefix} {chosen.length} {t.mitigation.localGenNoteSuffix}
            </div>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}
