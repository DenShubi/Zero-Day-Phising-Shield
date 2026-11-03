'use client';

/**
 * The confusion matrix, plus the two error rates that matter operationally.
 *
 * For a defensive system these are not symmetric: a false negative is a
 * phishing page the soldier was told was safe, while a false positive is an
 * analyst's wasted minute. The panel says so, because a jury reading raw
 * TP/TN/FP/FN counts should not have to infer which direction hurts.
 */

import type { BenchmarkMetrics } from '@/lib/api/endpoints';

function Cell({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'good' | 'bad';
  hint: string;
}) {
  const color = tone === 'good' ? 'var(--verdict-safe)' : 'var(--verdict-critical)';
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <p className="text-[0.7rem] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="vk-mono text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="mt-0.5 text-[0.7rem] leading-snug text-[var(--muted)]">{hint}</p>
    </div>
  );
}

export function ConfusionMatrix({ metrics }: { metrics: BenchmarkMetrics }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Matriks Konfusi ({metrics.total} sampel)
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Cell
          label="True Positive"
          value={metrics.tp}
          tone="good"
          hint="Ancaman terdeteksi sebagai ancaman"
        />
        <Cell
          label="False Negative"
          value={metrics.fn}
          tone="bad"
          hint="Ancaman lolos — prajurit diberi tahu aman"
        />
        <Cell
          label="False Positive"
          value={metrics.fp}
          tone="bad"
          hint="Konten aman ditandai ancaman — beban analis"
        />
        <Cell
          label="True Negative"
          value={metrics.tn}
          tone="good"
          hint="Konten aman dikenali aman"
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[var(--border)] pt-3 text-xs">
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">False Negative Rate</dt>
          <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
            {metrics.fnr.toFixed(2)}%
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">False Positive Rate</dt>
          <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
            {metrics.fpr.toFixed(2)}%
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-[0.7rem] leading-snug text-[var(--muted)]">
        Dalam sistem penangkalan, <em>false negative</em> jauh lebih mahal daripada{' '}
        <em>false positive</em>: yang pertama meloloskan ancaman ke tangan prajurit, yang kedua
        hanya menambah antrean peninjauan analis.
      </p>
    </section>
  );
}
