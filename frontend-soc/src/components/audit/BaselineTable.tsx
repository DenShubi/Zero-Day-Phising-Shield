'use client';

/**
 * Ablation: the fusion engine against the single-signal approaches it replaces.
 *
 * This is the table that answers "why not just check the domain?" — the point
 * of the multimodal design is that each single signal fails on a different
 * attack shape (a screenshot has no URL to check; a restyled clone defeats
 * layout similarity), and the comparison makes that concrete rather than
 * asserted.
 *
 * The final row is the full engine and is highlighted; the script emits it last.
 */

import type { BenchmarkBaseline } from '@/lib/api/endpoints';

const COLUMNS: { key: keyof BenchmarkBaseline; label: string; suffix?: string }[] = [
  { key: 'accuracy', label: 'Akurasi', suffix: '%' },
  { key: 'precision', label: 'Presisi', suffix: '%' },
  { key: 'recall', label: 'Recall', suffix: '%' },
  { key: 'specificity', label: 'Spesifisitas', suffix: '%' },
  { key: 'f1_score', label: 'F1', suffix: '%' },
  { key: 'roc_auc', label: 'ROC-AUC' },
  { key: 'pr_auc', label: 'PR-AUC' },
];

function cell(value: unknown, suffix?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  // AUC values are 0–1 and want more precision than a percentage does.
  return suffix ? `${value.toFixed(2)}${suffix}` : value.toFixed(4);
}

export function BaselineTable({ baselines }: { baselines: readonly BenchmarkBaseline[] }) {
  if (baselines.length === 0) return null;

  // The full engine is the last row the script appends.
  const bestIndex = baselines.length - 1;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Perbandingan Terhadap Model Baseline
      </h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Mengapa pendekatan tunggal tidak cukup menghadapi serangan multi-vektor.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="py-1.5 pr-3 font-semibold text-[var(--muted)]">Pendekatan</th>
              {COLUMNS.map((col) => (
                <th
                  key={String(col.key)}
                  className="px-2 py-1.5 text-right font-semibold text-[var(--muted)]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baselines.map((row, i) => {
              const isBest = i === bestIndex;
              return (
                <tr
                  key={row.model}
                  className="border-b border-[var(--border)] last:border-0"
                  style={
                    isBest
                      ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }
                      : undefined
                  }
                >
                  <td
                    className="py-1.5 pr-3"
                    style={{
                      color: isBest ? 'var(--accent-bright)' : 'var(--muted-strong)',
                      fontWeight: isBest ? 600 : 400,
                    }}
                  >
                    {row.model}
                  </td>
                  {COLUMNS.map((col) => (
                    <td
                      key={String(col.key)}
                      className="vk-mono px-2 py-1.5 text-right tabular-nums"
                      style={{ color: isBest ? 'var(--foreground)' : 'var(--muted-strong)' }}
                    >
                      {cell(row[col.key], col.suffix)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
