'use client';

/**
 * Tabel Confusion Matrix 2x2 yang ringkas dan mudah dibaca.
 */

import type { BenchmarkMetrics } from '@/lib/api/endpoints';
import { id as t } from '@/lib/i18n/id';
import {
  IconAlertTriangle,
  IconOctagonAlert,
  IconShieldCheck,
} from '@/components/ui/icons';

export function ConfusionMatrix({ metrics }: { metrics: BenchmarkMetrics }) {
  return (
    <div className="flex min-w-0 flex-col justify-between p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5">
        <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
          {t.audit.matrixTitle}
        </h2>
        <span className="vk-mono vk-tabular text-[0.75rem] text-[var(--muted-strong)]">
          {t.audit.matrixSubtitlePrefix} {metrics.total} {t.audit.samplesSuffix}
        </span>
      </div>

      <div className="overflow-x-auto rounded-[4px] border border-[var(--border)] bg-[var(--surface-0)]">
        <table className="w-full border-collapse text-[0.78rem]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
              <th scope="col" className="vk-pane-label px-3 py-2 text-[var(--muted-strong)]">
                Data Aktual \ Prediksi
              </th>
              <th scope="col" className="vk-pane-label border-l border-[var(--border)] px-3 py-2">
                Prediksi: Phishing
              </th>
              <th scope="col" className="vk-pane-label border-l border-[var(--border)] px-3 py-2">
                Prediksi: Aman
              </th>
              <th
                scope="col"
                className="vk-pane-label border-l border-[var(--border)] px-3 py-2 text-right"
              >
                Rasio Galat
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border)]">
            <tr>
              <th
                scope="row"
                className="bg-[var(--surface-1)] px-3 py-3 text-left align-top font-semibold text-[var(--foreground)]"
              >
                <div className="text-[0.8125rem]">Aktual: Phishing</div>
                <div className="vk-mono vk-tabular mt-0.5 text-[0.72rem] font-normal text-[var(--muted)]">
                  {metrics.tp + metrics.fn} sampel
                </div>
              </th>

              <td
                data-ui="matrix-cell"
                className="border-l border-[var(--border)] px-3.5 py-3 align-top"
                style={{
                  background: 'color-mix(in srgb, var(--verdict-safe) 7%, var(--surface-0))',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.75rem] font-medium text-[var(--muted-strong)]">
                    {t.audit.tpLabel}
                  </span>
                  <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                    <IconShieldCheck size={14} />
                  </span>
                </div>
                <div className="vk-mono vk-tabular my-1 text-[1.75rem] leading-none font-bold text-[var(--verdict-safe)]">
                  {metrics.tp}
                </div>
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.tpHint}</div>
              </td>

              <td
                data-ui="matrix-cell"
                className="border-l border-[var(--border)] px-3.5 py-3 align-top"
                style={{
                  background: 'color-mix(in srgb, var(--verdict-critical) 7%, var(--surface-0))',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.75rem] font-medium text-[var(--muted-strong)]">
                    {t.audit.fnLabel}
                  </span>
                  <span className="text-[var(--verdict-critical)]" aria-hidden="true">
                    <IconOctagonAlert size={14} />
                  </span>
                </div>
                <div className="vk-mono vk-tabular my-1 text-[1.75rem] leading-none font-bold text-[var(--verdict-critical)]">
                  {metrics.fn}
                </div>
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.fnHint}</div>
              </td>

              <td className="border-l border-[var(--border)] bg-[var(--surface-1)] px-3 py-3 text-right align-top">
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.fnrLabel}</div>
                <div
                  className="vk-mono vk-tabular mt-1 text-[1.125rem] font-bold"
                  style={{
                    color: metrics.fnr === 0 ? 'var(--verdict-safe)' : 'var(--verdict-critical)',
                  }}
                >
                  {metrics.fnr.toFixed(2)}%
                </div>
              </td>
            </tr>

            <tr>
              <th
                scope="row"
                className="bg-[var(--surface-1)] px-3 py-3 text-left align-top font-semibold text-[var(--foreground)]"
              >
                <div className="text-[0.8125rem]">Aktual: Aman</div>
                <div className="vk-mono vk-tabular mt-0.5 text-[0.72rem] font-normal text-[var(--muted)]">
                  {metrics.fp + metrics.tn} sampel
                </div>
              </th>

              <td
                data-ui="matrix-cell"
                className="border-l border-[var(--border)] px-3.5 py-3 align-top"
                style={{
                  background: 'color-mix(in srgb, var(--verdict-suspicious) 7%, var(--surface-0))',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.75rem] font-medium text-[var(--muted-strong)]">
                    {t.audit.fpLabel}
                  </span>
                  <span className="text-[var(--verdict-suspicious)]" aria-hidden="true">
                    <IconAlertTriangle size={14} />
                  </span>
                </div>
                <div className="vk-mono vk-tabular my-1 text-[1.75rem] leading-none font-bold text-[var(--verdict-suspicious)]">
                  {metrics.fp}
                </div>
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.fpHint}</div>
              </td>

              <td
                data-ui="matrix-cell"
                className="border-l border-[var(--border)] px-3.5 py-3 align-top"
                style={{
                  background: 'color-mix(in srgb, var(--verdict-safe) 7%, var(--surface-0))',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.75rem] font-medium text-[var(--muted-strong)]">
                    {t.audit.tnLabel}
                  </span>
                  <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                    <IconShieldCheck size={14} />
                  </span>
                </div>
                <div className="vk-mono vk-tabular my-1 text-[1.75rem] leading-none font-bold text-[var(--verdict-safe)]">
                  {metrics.tn}
                </div>
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.tnHint}</div>
              </td>

              <td className="border-l border-[var(--border)] bg-[var(--surface-1)] px-3 py-3 text-right align-top">
                <div className="text-[0.72rem] text-[var(--muted)]">{t.audit.fprLabel}</div>
                <div className="vk-mono vk-tabular mt-1 text-[1.125rem] font-bold text-[var(--foreground)]">
                  {metrics.fpr.toFixed(2)}%
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
