'use client';

/**
 * Halaman Hasil Evaluasi Akurasi & Kecepatan:
 * - Kiri (4 kolom): Ringkasan metrik utama & waktu pemindaian
 * - Kanan (8 kolom): Confusion Matrix 2x2 & perbandingan metode deteksi
 */

import { useEffect, useState } from 'react';
import {
  getBenchmark,
  type BenchmarkCi95,
  type BenchmarkLatency,
  type BenchmarkResponse,
} from '@/lib/api/endpoints';
import { BaselineTable } from '@/components/audit/BaselineTable';
import { ConfusionMatrix } from '@/components/audit/ConfusionMatrix';
import { formatWib } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconRefresh,
} from '@/components/ui/icons';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; data: BenchmarkResponse }
  | { phase: 'error'; message: string };

type DetailTab = 'baseline' | 'slices';

const TARGETS = {
  accuracy: 92,
  f1_score: 90,
  recall: 95,
  specificity: 90,
  auc: 0.95,
} as const;

export function AuditPanel() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [detailTab, setDetailTab] = useState<DetailTab>('baseline');
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void getBenchmark(ac.signal)
      .then((data) => !ac.signal.aborted && setState({ phase: 'ready', data }))
      .catch(() => {
        if (!ac.signal.aborted) {
          setState({ phase: 'error', message: t.audit.loadError });
        }
      });
    return () => ac.abort();
  }, [reloadKey]);

  const triggerReload = () => {
    setState({ phase: 'loading' });
    setReloadKey((k) => k + 1);
  };

  const copyCommand = () => {
    void navigator.clipboard?.writeText(t.audit.benchmarkCommand).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    });
  };

  if (state.phase === 'loading') {
    return (
      <section className="vk-panel-section">
        <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
          {t.audit.headline}
        </h1>
        <div
          data-ui="console-workspace"
          className="flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
          />
          <span>{t.common.loading}</span>
        </div>
      </section>
    );
  }

  const unavailableOrOffline =
    state.phase === 'error' || !state.data.available || !state.data.overall_metrics;

  if (unavailableOrOffline) {
    const serverNote = state.phase === 'ready' ? state.data.message : null;
    return (
      <section className="vk-panel-section">
        <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
          {t.audit.headline}
        </h1>

        <header className="vk-page-header vk-no-print">
          <span className="text-[0.78rem] text-[var(--muted)]">
            {t.audit.benchmarkFileNote}
          </span>

          <button
            type="button"
            onClick={triggerReload}
            className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.78rem]"
          >
            <IconRefresh size={13} />
            <span>{t.audit.ctaRefresh}</span>
          </button>
        </header>

        <div
          data-ui="console-workspace"
          className="flex flex-1 items-center justify-center bg-[var(--surface-2)] p-6"
        >
          <div className="vk-card max-w-lg p-6">
            <div className="flex items-center gap-2 text-[0.9375rem] font-semibold text-[var(--foreground)]">
              <span className="text-[var(--verdict-suspicious)]" aria-hidden="true">
                <IconAlertTriangle size={16} />
              </span>
              <span>{state.phase === 'error' ? state.message : t.audit.unavailableTitle}</span>
            </div>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--muted-strong)]">
              {t.audit.unavailableBody}
            </p>
            {serverNote && (
              <div className="mt-2.5 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[0.75rem] text-[var(--muted)]">
                {serverNote}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] border border-[var(--border-strong)] bg-[var(--canvas)] px-3.5 py-2">
              <code className="vk-mono break-all text-[0.78rem] text-[var(--accent-ink)]">
                {t.audit.benchmarkCommand}
              </code>
              <button
                type="button"
                onClick={copyCommand}
                className="vk-btn vk-btn-secondary h-7 shrink-0 px-2.5 text-[0.75rem]"
              >
                {copiedCmd ? <IconCheck size={12} /> : <IconCopy size={12} />}
                <span>{copiedCmd ? t.common.copied : t.common.copy}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const d = state.data;
  const m = d.overall_metrics!;
  const ci: BenchmarkCi95 = d.bootstrap_ci_95 ?? {};
  const slaSec = d.sla_target_sec ?? 5;
  const hasSlices = Boolean(d.slice_summaries && d.slice_summaries.length > 0);
  const hasBaselines = Boolean(d.baseline_comparison && d.baseline_comparison.length > 0);

  const specRows: {
    label: string;
    value: number | undefined;
    target: number;
    ci?: [number, number];
    suffix: '%' | '';
  }[] = [
    {
      label: t.audit.kpiAccuracy,
      value: m.accuracy,
      target: TARGETS.accuracy,
      ci: ci.accuracy_ci95,
      suffix: '%',
    },
    {
      label: t.audit.kpiF1,
      value: m.f1_score,
      target: TARGETS.f1_score,
      ci: ci.f1_ci95,
      suffix: '%',
    },
    {
      label: t.audit.kpiRecall,
      value: m.recall,
      target: TARGETS.recall,
      ci: ci.recall_ci95,
      suffix: '%',
    },
    {
      label: t.audit.kpiSpecificity,
      value: m.specificity,
      target: TARGETS.specificity,
      suffix: '%',
    },
    {
      label: t.audit.kpiAuc,
      value: m.roc_auc,
      target: TARGETS.auc,
      suffix: '',
    },
  ];

  const latencyRows: { label: string; data: BenchmarkLatency | undefined }[] = [
    { label: t.audit.latencyUrlTitle, data: d.playwright_url_latency_sec },
    { label: t.audit.latencyImgTitle, data: d.multimodal_image_latency_sec },
  ];

  return (
    <section className="vk-panel-section">
      <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
        {t.audit.headline}
      </h1>

      {/* Strip konteks: cakupan dan waktu ukur saja; tab sudah menamai panel. */}
      <header className="vk-page-header vk-no-print">
        <p className="text-[0.78rem] text-[var(--muted)]">
          <span className="vk-tabular font-medium text-[var(--foreground)]">{m.total}</span>{' '}
          {t.audit.subtitleSuffix}
          {d.generated_at ? ` · ${t.audit.measuredAtPrefix} ${formatWib(d.generated_at)}` : ''}
        </p>

        <button
          type="button"
          onClick={triggerReload}
          className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.78rem]"
        >
          <IconRefresh size={13} />
          <span>{t.audit.ctaRefresh}</span>
        </button>
      </header>

      {/* 2-Kolom Utama */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        {/* KIRI (4 Kolom): Ringkasan Metrik & Kecepatan */}
        <aside className="vk-scroll grid min-h-0 min-w-0 grid-cols-1 divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-0)] md:grid-cols-2 md:divide-x md:divide-y-0 lg:col-span-4 lg:flex lg:flex-col lg:divide-x-0 lg:divide-y">
          <div className="p-4">
            <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
              {t.audit.targetSpecTitle}
            </h2>

            <div className="mt-2.5 overflow-x-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-1)]">
              <table className="w-full border-collapse text-[0.78rem]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                    <th scope="col" className="vk-pane-label px-3 py-2">
                      Metrik
                    </th>
                    <th scope="col" className="vk-pane-label px-2.5 py-2 text-right">
                      Hasil
                    </th>
                    <th scope="col" className="vk-pane-label px-2.5 py-2 text-right">
                      {t.audit.ciPrefix}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {specRows.map((row) => {
                    if (row.value === undefined) return null;
                    const pass = row.value >= row.target;
                    const color = pass ? 'var(--verdict-safe)' : 'var(--verdict-critical)';
                    return (
                      <tr key={row.label}>
                        <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                          {row.label}
                        </td>
                        <td
                          className="vk-mono vk-tabular px-2.5 py-2 text-right text-[0.875rem] font-bold"
                          style={{ color }}
                        >
                          {row.suffix === '%'
                            ? `${row.value.toFixed(2)}%`
                            : row.value.toFixed(4)}
                        </td>
                        <td className="vk-mono vk-tabular px-2.5 py-2 text-right text-[0.72rem] text-[var(--muted)]">
                          {row.ci ? `${row.ci[0].toFixed(1)}..${row.ci[1].toFixed(1)}` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4">
            <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
              Kecepatan Pemindaian (Target &lt;= {slaSec} dtk)
            </h2>

            <div className="mt-2.5 overflow-x-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-1)]">
              <table className="w-full border-collapse text-[0.75rem]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                    <th scope="col" className="vk-pane-label px-3 py-2">
                      Jenis
                    </th>
                    <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                      {t.audit.meanLabel}
                    </th>
                    <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                      {t.audit.p95Label}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {latencyRows.map(({ label, data }) => {
                    if (!data || data.count === 0) return null;
                    return (
                      <tr key={label}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-[var(--foreground)]">{label}</div>
                          <div className="vk-mono text-[0.6875rem] text-[var(--muted)]">
                            {data.count} {t.audit.samplesSuffix}
                          </div>
                        </td>
                        <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--foreground)]">
                          {data.mean.toFixed(2)}s
                        </td>
                        <td
                          className="vk-mono vk-tabular px-2 py-2 text-right font-semibold"
                          style={{
                            color:
                              data.p95 > slaSec
                                ? 'var(--verdict-suspicious)'
                                : 'var(--verdict-safe)',
                          }}
                        >
                          {data.p95.toFixed(2)}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </aside>

        {/* KANAN (8 Kolom): Confusion Matrix & Perbandingan Metode */}
        <div className="vk-scroll flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-1)] lg:col-span-8">
          <ConfusionMatrix metrics={m} />

          {hasBaselines && detailTab === 'baseline' && !hasSlices ? (
            <BaselineTable baselines={d.baseline_comparison!} />
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                  {detailTab === 'baseline' ? t.audit.baselineTitle : t.audit.sliceTitle}
                </h2>

                {hasBaselines && hasSlices && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDetailTab('baseline')}
                      aria-pressed={detailTab === 'baseline'}
                      className="vk-chip h-7 text-[0.75rem]"
                    >
                      {t.audit.colApproach}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('slices')}
                      aria-pressed={detailTab === 'slices'}
                      className="vk-chip h-7 text-[0.75rem]"
                    >
                      {t.audit.colSlice}
                    </button>
                  </div>
                )}
              </div>

              {detailTab === 'baseline' && d.baseline_comparison ? (
                <div
                  role="region"
                  aria-label={t.audit.baselineTitle}
                  tabIndex={0}
                  className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-0)]"
                >
                  <table className="w-full border-collapse text-[0.78rem]">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                      <tr className="border-b border-[var(--border)] text-left">
                        <th scope="col" className="vk-pane-label px-3 py-2">
                          {t.audit.colApproach}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colAccuracy}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colPrecision}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colRecall}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colF1}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colRocAuc}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {d.baseline_comparison.map((row, idx) => {
                        const isBest = idx === d.baseline_comparison!.length - 1;
                        return (
                          <tr
                            key={row.model}
                            style={isBest ? { background: 'var(--accent-tint)' } : undefined}
                          >
                            <td
                              className="px-3 py-2"
                              style={{
                                color: isBest ? 'var(--accent-ink)' : 'var(--muted-strong)',
                                fontWeight: isBest ? 600 : 400,
                              }}
                            >
                              {row.model}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--foreground)]">
                              {row.accuracy !== undefined ? `${row.accuracy.toFixed(2)}%` : '-'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.precision !== undefined ? `${row.precision.toFixed(2)}%` : '-'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.recall !== undefined ? `${row.recall.toFixed(2)}%` : '-'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--foreground)]">
                              {row.f1_score !== undefined ? `${row.f1_score.toFixed(2)}%` : '-'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.roc_auc !== undefined ? row.roc_auc.toFixed(4) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : d.slice_summaries ? (
                <div
                  role="region"
                  aria-label={t.audit.sliceTitle}
                  tabIndex={0}
                  className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-0)]"
                >
                  <table className="w-full border-collapse text-[0.78rem]">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                      <tr className="border-b border-[var(--border)] text-left">
                        <th scope="col" className="vk-pane-label px-3 py-2">
                          {t.audit.colSlice}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2">
                          {t.audit.colModality}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colCount}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colAccuracy}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.meanLabel}
                        </th>
                        <th scope="col" className="vk-pane-label px-2 py-2 text-right">
                          {t.audit.colP95}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {d.slice_summaries.map((s) => (
                        <tr key={s.slice_name}>
                          <td className="px-3 py-2 text-[var(--foreground)]">{s.slice_name}</td>
                          <td className="vk-mono px-2 py-2 text-[var(--muted)]">{s.modality}</td>
                          <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                            {s.count}
                          </td>
                          <td
                            className="vk-mono vk-tabular px-2 py-2 text-right font-semibold"
                            style={{
                              color:
                                s.accuracy >= TARGETS.accuracy
                                  ? 'var(--verdict-safe)'
                                  : 'var(--verdict-suspicious)',
                            }}
                          >
                            {s.accuracy.toFixed(2)}%
                          </td>
                          <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                            {s.mean_sec.toFixed(2)}s
                          </td>
                          <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                            {s.p95_sec.toFixed(2)}s
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
