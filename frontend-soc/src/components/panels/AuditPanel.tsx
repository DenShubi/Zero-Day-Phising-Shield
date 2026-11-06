'use client';

/**
 * Audit Akurasi panel: Hero Confusion Matrix + sticky-header Baseline Ablation
 * & Slice tables, backed strictly by measured phase3_benchmark_results.json.
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
  IconOctagonAlert,
  IconRefresh,
  IconShieldCheck,
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

function AuditKpiTile({
  label,
  value,
  target,
  ci,
  suffix = '%',
}: {
  label: string;
  value: number | undefined;
  target?: number;
  ci?: [number, number];
  suffix?: string;
}) {
  if (value === undefined) return null;
  const pass = target === undefined ? null : value >= target;
  const color =
    pass === null ? 'var(--foreground)' : pass ? 'var(--verdict-safe)' : 'var(--verdict-critical)';

  return (
    <div className="vk-bento flex min-w-0 flex-col justify-between px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[0.8125rem] font-medium leading-tight text-[var(--muted)]">
          {label}
        </span>
        {pass !== null && (
          <span className="shrink-0" style={{ color }}>
            {pass ? <IconShieldCheck size={14} /> : <IconOctagonAlert size={14} />}
          </span>
        )}
      </div>

      <div
        className="vk-mono vk-tabular mt-1 text-[1.5rem] leading-[1.1] font-bold tracking-[-0.02em]"
        style={{ color }}
      >
        {suffix === '%' ? `${value.toFixed(2)}%` : value.toFixed(4)}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[0.75rem] text-[var(--muted)]">
        {ci ? (
          <span className="vk-mono vk-tabular">
            {t.audit.ciPrefix} {ci[0].toFixed(1)}–{ci[1].toFixed(1)}
          </span>
        ) : (
          <span />
        )}
        {target !== undefined && (
          <span style={{ color }}>
            {t.audit.targetPrefix} {suffix === '%' ? `${target}%` : target.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function CompactLatencyCard({
  title,
  latency,
  slaSec,
}: {
  title: string;
  latency: BenchmarkLatency | undefined;
  slaSec: number;
}) {
  if (!latency || latency.count === 0) return null;
  const pass = latency.sla_pass_pct >= 100;
  const statusColor = pass ? 'var(--verdict-safe)' : 'var(--verdict-suspicious)';

  return (
    <div className="vk-bento flex min-w-0 flex-col justify-between p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--foreground)]">
          {title}
        </h4>
        <span className="vk-mono vk-tabular text-[0.75rem] text-[var(--muted)]">
          {latency.count} {t.audit.samplesSuffix}
        </span>
      </div>

      {/* Two columns below 1280px: at 1024 a 4-up split leaves each cell too
          narrow for "Maksimum" + a 5-char duration, and the text runs out of
          its box. Four across returns at xl, which covers the 1440x900 demo. */}
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[0.8125rem] xl:grid-cols-4">
        {(
          [
            ['mean', t.audit.meanLabel],
            ['p50', t.audit.p50Label],
            ['p95', t.audit.p95Label],
            ['max', t.audit.maxLabel],
          ] as const
        ).map(([k, label]) => (
          <div
            key={k}
            className="min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1"
          >
            <dt className="text-[0.75rem] text-[var(--muted)]">{label}</dt>
            <dd
              className="vk-mono vk-tabular font-semibold"
              style={{
                color: latency[k] > slaSec ? 'var(--verdict-suspicious)' : 'var(--foreground)',
              }}
            >
              {latency[k].toFixed(2)}s
            </dd>
          </div>
        ))}
      </dl>

      <div
        className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium"
        style={{ color: statusColor }}
      >
        {pass ? <IconShieldCheck size={13} /> : <IconAlertTriangle size={13} />}
        <span>
          {latency.sla_pass_pct.toFixed(1)}% {t.audit.underSlaSuffix} {slaSec}{' '}
          {t.audit.secondsUnit}
        </span>
      </div>
    </div>
  );
}

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
        <div className="shrink-0">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.audit.headline}
          </h1>
          <p className="mt-0.5 max-w-[66ch] text-[1rem] leading-[1.5] text-[var(--muted-strong)]">
            {t.audit.baselineSubtitle}
          </p>
        </div>
        <div
          data-ui="console-workspace"
          className="vk-bento flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
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
        <div className="shrink-0">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.audit.headline}
          </h1>
          <p className="mt-0.5 max-w-[66ch] text-[1rem] leading-[1.5] text-[var(--muted-strong)]">
            {t.audit.baselineSubtitle}
          </p>
        </div>

        <div data-ui="console-workspace" className="flex min-h-0 flex-1 flex-col gap-3.5">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
            <span className="inline-flex items-center gap-2">
              <span className="text-[var(--verdict-suspicious)]">
                <IconAlertTriangle size={15} />
              </span>
              <span>{state.phase === 'error' ? state.message : t.audit.unavailableTitle}</span>
            </span>
            <button
              type="button"
              onClick={triggerReload}
              className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.8125rem]"
            >
              <IconRefresh size={14} />
              <span>{t.feed.refresh}</span>
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
            <div className="vk-bento flex min-w-0 flex-col justify-between p-5 lg:col-span-7">
              <div>
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.audit.unavailableTitle}
                </h3>
                <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-[1.55] text-[var(--muted-strong)]">
                  {t.audit.unavailableBody}
                </p>

                {serverNote && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted)]">
                    {serverNote}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--canvas)] px-4 py-3">
                  <code className="vk-mono break-all text-[0.875rem] text-[var(--accent-ink)]">
                    {t.audit.benchmarkCommand}
                  </code>
                  <button
                    type="button"
                    onClick={copyCommand}
                    className="vk-btn vk-btn-secondary h-8 shrink-0 px-2.5 text-[0.8125rem]"
                  >
                    {copiedCmd ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    <span>{copiedCmd ? t.common.copied : t.common.copy}</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[0.8125rem] text-[var(--muted)]">
                {t.audit.benchmarkFileNote}
              </div>
            </div>

            <div className="vk-bento flex min-w-0 flex-col justify-between p-5 lg:col-span-5">
              <div>
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.audit.targetSpecTitle}
                </h3>
                <div className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
                  {t.audit.targetSpecNote}
                </div>

                <dl className="mt-4 flex flex-col gap-2 text-[0.8125rem]">
                  {[
                    [t.audit.kpiAccuracy, `≥ ${TARGETS.accuracy}%`],
                    [t.audit.kpiF1, `≥ ${TARGETS.f1_score}%`],
                    [t.audit.kpiRecall, `≥ ${TARGETS.recall}%`],
                    [t.audit.kpiSpecificity, `≥ ${TARGETS.specificity}%`],
                    [t.audit.kpiAuc, `≥ ${TARGETS.auc.toFixed(2)}`],
                  ].map(([name, threshold]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3.5 py-2.5"
                    >
                      <dt className="font-medium text-[var(--foreground)]">{name}</dt>
                      <dd className="vk-mono vk-tabular font-semibold text-[var(--accent-ink)]">
                        {threshold}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
                {t.audit.asymmetryNote}
              </div>
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

  return (
    <section className="vk-panel-section">
      {/* Title Row */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.audit.headline}
          </h1>
          <p className="mt-0.5 max-w-[68ch] text-[0.875rem] text-[var(--muted-strong)]">
            {t.audit.subtitlePrefix} {m.total} {t.audit.subtitleSuffix}
            {d.generated_at ? ` ${t.audit.measuredAtPrefix} ${formatWib(d.generated_at)}.` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={triggerReload}
          className="vk-btn vk-btn-primary h-9 px-3.5 text-[0.875rem]"
        >
          <IconRefresh size={15} />
          <span>{t.audit.ctaRefresh}</span>
        </button>
      </div>

      {/* Interactive Audit Workspace */}
      <div data-ui="console-workspace" className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Top KPI Row */}
        <div className="grid shrink-0 grid-cols-2 gap-2.5 md:grid-cols-5">
          <AuditKpiTile
            label={t.audit.kpiAccuracy}
            value={m.accuracy}
            target={TARGETS.accuracy}
            ci={ci.accuracy_ci95}
          />
          <AuditKpiTile
            label={t.audit.kpiF1}
            value={m.f1_score}
            target={TARGETS.f1_score}
            ci={ci.f1_ci95}
          />
          <AuditKpiTile
            label={t.audit.kpiRecall}
            value={m.recall}
            target={TARGETS.recall}
            ci={ci.recall_ci95}
          />
          <AuditKpiTile
            label={t.audit.kpiSpecificity}
            value={m.specificity}
            target={TARGETS.specificity}
          />
          <AuditKpiTile
            label={t.audit.kpiAuc}
            value={m.roc_auc}
            target={TARGETS.auc}
            suffix=""
          />
        </div>

        {/* Main 12-Col Bento: Hero Confusion Matrix + Latency & Sticky Baseline/Slice Tables */}
        <div className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
          <div className="flex min-h-0 min-w-0 flex-col lg:col-span-5">
            <ConfusionMatrix metrics={m} />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:col-span-7">
            {/* Compact Latency Pair */}
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
              <CompactLatencyCard
                title={t.audit.latencyUrlTitle}
                latency={d.playwright_url_latency_sec}
                slaSec={slaSec}
              />
              <CompactLatencyCard
                title={t.audit.latencyImgTitle}
                latency={d.multimodal_image_latency_sec}
                slaSec={slaSec}
              />
            </div>

            {/* Tabbed Sticky-Header Baseline / Slice Table */}
            {hasBaselines && detailTab === 'baseline' && !hasSlices ? (
              <BaselineTable baselines={d.baseline_comparison!} />
            ) : (
              <div className="vk-bento flex min-h-0 min-w-0 flex-1 flex-col p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                    {detailTab === 'baseline' ? t.audit.baselineTitle : t.audit.sliceTitle}
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasBaselines && hasSlices && (
                      <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                        <button
                          type="button"
                          onClick={() => setDetailTab('baseline')}
                          aria-pressed={detailTab === 'baseline'}
                          className={[
                            'rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
                            detailTab === 'baseline'
                              ? 'bg-[var(--accent-tint)] text-[var(--foreground)]'
                              : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                          ].join(' ')}
                        >
                          {t.audit.colApproach}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailTab('slices')}
                          aria-pressed={detailTab === 'slices'}
                          className={[
                            'rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
                            detailTab === 'slices'
                              ? 'bg-[var(--accent-tint)] text-[var(--foreground)]'
                              : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                          ].join(' ')}
                        >
                          {t.audit.colSlice}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={triggerReload}
                      className="vk-btn vk-btn-secondary h-8 px-2.5 text-[0.8125rem]"
                    >
                      <IconRefresh size={14} />
                      <span>{t.feed.refresh}</span>
                    </button>
                  </div>
                </div>

              {detailTab === 'baseline' && d.baseline_comparison ? (
                <div className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full border-collapse text-[0.8125rem]">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                      <tr className="border-b border-[var(--border)] text-left">
                        <th className="px-3 py-2 font-medium text-[var(--muted)]">
                          {t.audit.colApproach}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colAccuracy}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colPrecision}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colRecall}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colF1}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colRocAuc}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.baseline_comparison.map((row, idx) => {
                        const isBest = idx === d.baseline_comparison!.length - 1;
                        return (
                          <tr
                            key={row.model}
                            className="border-b border-[var(--border-subtle)] last:border-0"
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
                              {row.accuracy !== undefined ? `${row.accuracy.toFixed(2)}%` : '—'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.precision !== undefined ? `${row.precision.toFixed(2)}%` : '—'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.recall !== undefined ? `${row.recall.toFixed(2)}%` : '—'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--foreground)]">
                              {row.f1_score !== undefined ? `${row.f1_score.toFixed(2)}%` : '—'}
                            </td>
                            <td className="vk-mono vk-tabular px-2 py-2 text-right text-[var(--muted-strong)]">
                              {row.roc_auc !== undefined ? row.roc_auc.toFixed(4) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : d.slice_summaries ? (
                <div className="vk-scroll mt-2.5 min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full border-collapse text-[0.8125rem]">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                      <tr className="border-b border-[var(--border)] text-left">
                        <th className="px-3 py-2 font-medium text-[var(--muted)]">
                          {t.audit.colSlice}
                        </th>
                        <th className="px-2 py-2 font-medium text-[var(--muted)]">
                          {t.audit.colModality}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colCount}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colAccuracy}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.meanLabel}
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-[var(--muted)]">
                          {t.audit.colP95}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.slice_summaries.map((s) => (
                        <tr
                          key={s.slice_name}
                          className="border-b border-[var(--border-subtle)] last:border-0"
                        >
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
      </div>
    </section>
  );
}
