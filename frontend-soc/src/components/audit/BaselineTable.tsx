'use client';

/**
 * Ablation study table: compares full multimodal fusion (final row) against
 * single-signal detector baselines, with sticky header and tabular numerals.
 */

import type { BenchmarkBaseline } from '@/lib/api/endpoints';
import { id as t } from '@/lib/i18n/id';

const COLUMNS: { key: keyof BenchmarkBaseline; label: string; suffix?: string }[] = [
  { key: 'accuracy', label: t.audit.colAccuracy, suffix: '%' },
  { key: 'precision', label: t.audit.colPrecision, suffix: '%' },
  { key: 'recall', label: t.audit.colRecall, suffix: '%' },
  { key: 'specificity', label: t.audit.colSpecificity, suffix: '%' },
  { key: 'f1_score', label: t.audit.colF1, suffix: '%' },
  { key: 'roc_auc', label: t.audit.colRocAuc },
  { key: 'pr_auc', label: t.audit.colPrAuc },
];

function formatCell(value: unknown, suffix?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return suffix ? `${value.toFixed(2)}${suffix}` : value.toFixed(4);
}

export function BaselineTable({ baselines }: { baselines: readonly BenchmarkBaseline[] }) {
  if (baselines.length === 0) return null;

  const bestIndex = baselines.length - 1;

  return (
    <div className="vk-bento flex min-h-0 min-w-0 flex-col p-4">
      <div>
        <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          {t.audit.baselineTitle}
        </h3>
        <div className="mt-0.5 text-[0.8125rem] text-[var(--muted)]">
          {t.audit.baselineSubtitle}
        </div>
      </div>

      <div className="vk-scroll mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-3 py-2 font-medium text-[var(--muted)]">{t.audit.colApproach}</th>
              {COLUMNS.map((col) => (
                <th
                  key={String(col.key)}
                  className="px-2.5 py-2 text-right font-medium text-[var(--muted)]"
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
                  className="border-b border-[var(--border-subtle)] last:border-0"
                  style={
                    isBest
                      ? { background: 'var(--accent-tint)' }
                      : undefined
                  }
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
                  {COLUMNS.map((col) => (
                    <td
                      key={String(col.key)}
                      className="vk-mono vk-tabular px-2.5 py-2 text-right"
                      style={{
                        color: isBest ? 'var(--foreground)' : 'var(--muted-strong)',
                        fontWeight: isBest ? 600 : 400,
                      }}
                    >
                      {formatCell(row[col.key], col.suffix)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
