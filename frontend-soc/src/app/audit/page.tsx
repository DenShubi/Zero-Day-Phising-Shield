'use client';

/**
 * Accuracy and latency audit — the measured evidence behind the engine.
 *
 * Everything here is rendered from storage/phase3_benchmark_results.json via
 * /api/v1/benchmark/phase3. That file is gitignored and is only produced by
 * `python scripts/benchmark_phase3.py`, so the unavailable state is the normal
 * state on a fresh clone and is handled as a first-class case rather than an
 * error — with the exact command needed to populate it.
 *
 * Nothing on this page is hardcoded or fabricated: if the benchmark has not
 * been run, the page says so instead of showing numbers.
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

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; data: BenchmarkResponse }
  | { phase: 'error'; message: string };

/** Thresholds from the competition brief, used only to label pass/fail. */
const TARGETS = {
  accuracy: 92,
  f1_score: 90,
  recall: 95,
  specificity: 90,
  auc: 0.95,
} as const;

function Kpi({
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="vk-mono mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {suffix === '%' ? value.toFixed(2) : value.toFixed(4)}
        {suffix === '%' && <span className="text-base">%</span>}
      </p>
      {ci && (
        <p className="vk-mono mt-0.5 text-[0.7rem] text-[var(--muted)]">
          95% CI {ci[0].toFixed(2)}–{ci[1].toFixed(2)}
        </p>
      )}
      {target !== undefined && (
        <p className="mt-0.5 text-[0.7rem]" style={{ color }}>
          target ≥ {suffix === '%' ? target : target.toFixed(2)} · {pass ? 'lulus' : 'belum'}
        </p>
      )}
    </div>
  );
}

function LatencyCard({
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

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{latency.count} sampel</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
        {(['mean', 'p50', 'p95', 'max'] as const).map((k) => (
          <div key={k} className="flex justify-between">
            <dt className="text-[var(--muted)]">{k === 'mean' ? 'rerata' : k.toUpperCase()}</dt>
            <dd
              className="vk-mono tabular-nums"
              style={{
                color: latency[k] > slaSec ? 'var(--verdict-suspicious)' : 'var(--muted-strong)',
              }}
            >
              {latency[k].toFixed(3)} s
            </dd>
          </div>
        ))}
      </dl>
      <p
        className="mt-2 border-t border-[var(--border)] pt-2 text-xs"
        style={{ color: pass ? 'var(--verdict-safe)' : 'var(--verdict-suspicious)' }}
      >
        {latency.sla_pass_pct.toFixed(1)}% di bawah SLA {slaSec} detik
      </p>
    </div>
  );
}

export default function AuditPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    void getBenchmark(ac.signal)
      .then((data) => !ac.signal.aborted && setState({ phase: 'ready', data }))
      .catch((e: unknown) => {
        if (!ac.signal.aborted) {
          setState({
            phase: 'error',
            message: e instanceof Error ? e.message : 'Gagal memuat telemetri audit.',
          });
        }
      });
    return () => ac.abort();
  }, []);

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

  const d = state.data;

  // The normal state on a fresh clone: the results file is gitignored and only
  // exists once the benchmark has been run.
  if (!d.available || !d.overall_metrics) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{t.nav.audit}</h1>
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--muted-strong)]">
            Telemetri audit belum tersedia pada mesin ini.
          </p>
          {d.message && <p className="mt-1.5 text-xs text-[var(--muted)]">{d.message}</p>}
          <p className="mt-3 text-xs text-[var(--muted)]">
            Jalankan pengukuran untuk menghasilkan{' '}
            <span className="vk-mono">storage/phase3_benchmark_results.json</span>:
          </p>
          <pre className="vk-mono mt-2 overflow-x-auto rounded bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)]">
            python scripts/benchmark_phase3.py
          </pre>
          <p className="mt-3 text-[0.7rem] leading-snug text-[var(--muted)]">
            Halaman ini sengaja tidak menampilkan angka apa pun sebelum pengukuran dijalankan —
            seluruh metrik di bawah berasal dari berkas hasil, bukan nilai tetap.
          </p>
        </div>
      </div>
    );
  }

  const m = d.overall_metrics;
  const ci: BenchmarkCi95 = d.bootstrap_ci_95 ?? {};
  const slaSec = d.sla_target_sec ?? 5;
  const conc = d.concurrency_4x_summary;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{t.nav.audit}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Evaluasi akurasi deteksi dan latensi terhadap {m.total} sampel uji multimodal.
          {d.generated_at && ` Diukur ${formatWib(d.generated_at)}.`}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Akurasi"
          value={m.accuracy}
          target={TARGETS.accuracy}
          ci={ci.accuracy_ci95}
        />
        <Kpi label="F1-Score" value={m.f1_score} target={TARGETS.f1_score} ci={ci.f1_ci95} />
        <Kpi label="Recall" value={m.recall} target={TARGETS.recall} ci={ci.recall_ci95} />
        <Kpi label="Spesifisitas" value={m.specificity} target={TARGETS.specificity} />
        <Kpi label="ROC-AUC" value={m.roc_auc} target={TARGETS.auc} suffix="" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ConfusionMatrix metrics={m} />

        <div className="flex flex-col gap-5">
          <LatencyCard
            title="Latensi Sandbox URL (Playwright)"
            latency={d.playwright_url_latency_sec}
            slaSec={slaSec}
          />
          <LatencyCard
            title="Latensi Gambar/Poster Multimodal"
            latency={d.multimodal_image_latency_sec}
            slaSec={slaSec}
          />
        </div>
      </div>

      {d.slice_summaries && d.slice_summaries.length > 0 && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Akurasi &amp; Latensi per Irisan Dataset
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="py-1.5 pr-3 font-semibold text-[var(--muted)]">Irisan</th>
                  <th className="px-2 py-1.5 font-semibold text-[var(--muted)]">Modalitas</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">N</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">
                    Akurasi
                  </th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">
                    Rerata
                  </th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">P95</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]">
                    &lt; {slaSec}s
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.slice_summaries.map((s) => (
                  <tr key={s.slice_name} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-1.5 pr-3 text-[var(--muted-strong)]">{s.slice_name}</td>
                    <td className="vk-mono px-2 py-1.5 text-[0.7rem] text-[var(--muted)]">
                      {s.modality}
                    </td>
                    <td className="vk-mono px-2 py-1.5 text-right tabular-nums text-[var(--muted-strong)]">
                      {s.count}
                    </td>
                    <td
                      className="vk-mono px-2 py-1.5 text-right tabular-nums"
                      style={{
                        color:
                          s.accuracy >= TARGETS.accuracy
                            ? 'var(--verdict-safe)'
                            : 'var(--verdict-suspicious)',
                      }}
                    >
                      {s.accuracy.toFixed(2)}%
                    </td>
                    <td className="vk-mono px-2 py-1.5 text-right tabular-nums text-[var(--muted-strong)]">
                      {s.mean_sec.toFixed(3)}s
                    </td>
                    <td className="vk-mono px-2 py-1.5 text-right tabular-nums text-[var(--muted-strong)]">
                      {s.p95_sec.toFixed(3)}s
                    </td>
                    <td className="vk-mono px-2 py-1.5 text-right tabular-nums text-[var(--muted-strong)]">
                      {s.sla_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.baseline_comparison && <BaselineTable baselines={d.baseline_comparison} />}

      {conc && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Uji Konkurensi Sandbox ({conc.concurrent_requests}× simultan)
          </h2>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-xs">
            <div>
              <dt className="text-[var(--muted)]">Batch wall-clock</dt>
              <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
                {conc.wall_batch_sec.toFixed(3)} s
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Rerata per permintaan</dt>
              <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
                {conc.mean_individual_sec.toFixed(3)} s
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Maksimum per permintaan</dt>
              <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
                {conc.max_individual_sec.toFixed(3)} s
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Seluruhnya di bawah SLA</dt>
              <dd
                style={{
                  color: conc.all_under_5s_sla
                    ? 'var(--verdict-safe)'
                    : 'var(--verdict-suspicious)',
                }}
              >
                {conc.all_under_5s_sla ? 'ya' : 'tidak'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {d.browser_pool_warmup_ms !== undefined && (
        <p className="text-xs text-[var(--muted)]">
          Pemanasan pool Chromium sekali saat inisialisasi:{' '}
          <span className="vk-mono">{(d.browser_pool_warmup_ms / 1000).toFixed(2)} detik</span>.
          Pemindaian berikutnya menggunakan konteks terisolasi di atas instance yang sudah hangat,
          sehingga angka latensi di atas adalah jalur hangat.
        </p>
      )}
    </div>
  );
}
