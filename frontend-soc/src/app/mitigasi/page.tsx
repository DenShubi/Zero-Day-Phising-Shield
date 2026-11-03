'use client';

/**
 * Automated mitigation: turn incidents into deployable blocklists.
 *
 * Generation is entirely client-side and downloads via a Blob, so this works on
 * static hosting with no server round trip and no extra backend endpoint.
 *
 * This is submission screenshot #5.
 */

import { useEffect, useMemo, useState } from 'react';
import { getIncidents } from '@/lib/api/endpoints';
import {
  LOW_CONFIDENCE,
  PROVENANCE_LABEL,
  extractIocs,
  type Ioc,
  type RejectedHost,
} from '@/lib/blocklist/extract';
import { FORMATS, downloadText, renderFormat, type FormatId } from '@/lib/blocklist/formats';
import { formatScore, formatWib } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { VERDICT_ORDER, type Verdict } from '@/lib/verdict';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; iocs: Ioc[]; rejected: RejectedHost[] }
  | { phase: 'error'; message: string };

export default function MitigationPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [minVerdicts, setMinVerdicts] = useState<ReadonlySet<Verdict>>(
    () => new Set<Verdict>(['CRITICAL_PHISHING']),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [preview, setPreview] = useState<FormatId | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void getIncidents(100, ac.signal)
      .then((scans) => {
        if (ac.signal.aborted) return;
        const { iocs, rejected } = extractIocs(scans);
        setState({ phase: 'ready', iocs, rejected });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) {
          setState({
            phase: 'error',
            message: e instanceof Error ? e.message : 'Gagal memuat insiden.',
          });
        }
      });
    return () => ac.abort();
  }, []);

  const visible = useMemo(() => {
    if (state.phase !== 'ready') return [];
    return state.iocs.filter((i) => minVerdicts.has(i.verdict));
  }, [state, minVerdicts]);

  // Default selection follows the filter, but leaves OCR-derived hosts out:
  // those are the ones whose characters may simply have been misread.
  useEffect(() => {
    setSelected(
      new Set(visible.filter((i) => !LOW_CONFIDENCE.has(i.provenance)).map((i) => i.host)),
    );
  }, [visible]);

  const chosen = useMemo(
    () => visible.filter((i) => selected.has(i.host)),
    [visible, selected],
  );

  if (state.phase === 'loading') {
    return <p className="p-8 text-sm text-[var(--muted)]">{t.common.loading}</p>;
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-lg font-semibold text-[var(--verdict-critical)]">{t.common.error}</h1>
        <p className="mt-2 text-sm text-[var(--muted-strong)]">{state.message}</p>
      </div>
    );
  }

  const toggleVerdict = (v: Verdict) =>
    setMinVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const toggleHost = (host: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{t.mitigation.title}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t.mitigation.subtitle}</p>
      </header>

      <p className="rounded border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted-strong)]">
        {t.mitigation.simulationNotice}
      </p>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Indikator ({chosen.length} dipilih dari {visible.length})
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {VERDICT_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVerdict(v)}
                aria-pressed={minVerdicts.has(v)}
                className="rounded border px-2 py-1 text-xs transition-opacity"
                style={{
                  borderColor: 'var(--border)',
                  opacity: minVerdicts.has(v) ? 1 : 0.4,
                  background: minVerdicts.has(v) ? 'var(--surface-raised)' : 'transparent',
                }}
              >
                <VerdictBadge verdict={v} size="sm" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === visible.length ? new Set() : new Set(visible.map((i) => i.host)),
              )
            }
            className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
          >
            {selected.size === visible.length ? 'Kosongkan' : t.mitigation.selectAll}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Tidak ada indikator untuk filter ini. Jalankan pemindaian dari Konsol terlebih dahulu.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="w-8 py-1.5" />
                  <th className="py-1.5 pr-3 font-semibold text-[var(--muted)]">Host</th>
                  <th className="px-2 py-1.5 font-semibold text-[var(--muted)]">Putusan</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">Skor</th>
                  <th className="px-2 py-1.5 font-semibold text-[var(--muted)]">
                    {t.mitigation.provenance}
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-[var(--muted)]">Tiket</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => {
                  const low = LOW_CONFIDENCE.has(i.provenance);
                  return (
                    <tr key={i.host} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(i.host)}
                          onChange={() => toggleHost(i.host)}
                          aria-label={`Sertakan ${i.host}`}
                        />
                      </td>
                      <td className="vk-mono py-1.5 pr-3 text-[var(--foreground)]">{i.host}</td>
                      <td className="px-2 py-1.5">
                        <VerdictBadge verdict={i.verdict} size="sm" />
                      </td>
                      <td className="vk-mono px-2 py-1.5 text-right tabular-nums text-[var(--muted-strong)]">
                        {formatScore(i.riskScore)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-[var(--muted-strong)]">
                          {PROVENANCE_LABEL[i.provenance]}
                        </span>
                        {low && (
                          <span
                            className="ml-1.5 rounded border px-1 py-0.5 text-[0.65rem]"
                            style={{
                              color: 'var(--verdict-suspicious)',
                              borderColor:
                                'color-mix(in srgb, var(--verdict-suspicious) 40%, transparent)',
                            }}
                          >
                            {t.mitigation.lowConfidence}
                          </span>
                        )}
                      </td>
                      <td className="vk-mono px-2 py-1.5 text-[0.7rem] text-[var(--muted)]">
                        {i.ticket ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {state.rejected.length > 0 && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setShowRejected((v) => !v)}
              className="text-xs text-[var(--muted-strong)] underline"
            >
              {state.rejected.length} kandidat ditolak validator
            </button>
            {showRejected && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {state.rejected.slice(0, 40).map((r, idx) => (
                  <li key={`${r.raw}-${idx}`} className="vk-mono text-[0.7rem] text-[var(--muted)]">
                    {r.raw} — {r.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Format Ekspor</h2>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FORMATS.map((f) => (
            <div
              key={f.id}
              className="flex flex-col rounded border border-[var(--border)] bg-[var(--surface-raised)] p-3"
            >
              <p className="text-sm font-medium text-[var(--foreground)]">{f.label}</p>
              <p className="mt-0.5 flex-1 text-[0.7rem] leading-snug text-[var(--muted)]">
                {f.description}
              </p>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={() => downloadText(f.filename, f.mime, renderFormat(f.id, chosen))}
                  className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {t.mitigation.download}
                </button>
                <button
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={() => setPreview(preview === f.id ? null : f.id)}
                  className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-strong)] disabled:opacity-40"
                >
                  {preview === f.id ? 'Tutup' : 'Pratinjau'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {preview && chosen.length > 0 && (
          <pre className="vk-mono mt-3 max-h-96 overflow-auto rounded bg-[var(--background)] p-3 text-[0.7rem] leading-relaxed text-[var(--muted-strong)]">
            {renderFormat(preview, chosen)}
          </pre>
        )}
      </section>

      {chosen.length > 0 && (
        <p className="text-xs text-[var(--muted)]">
          Dihasilkan {formatWib(new Date().toISOString())} dari {chosen.length} indikator terpilih.
          Seluruh berkas dibuat di peramban — tidak ada data yang dikirim ke layanan pihak ketiga.
        </p>
      )}
    </div>
  );
}
