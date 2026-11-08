'use client';

/**
 * Indikator progres pemindaian saat proses berjalan.
 */

import { useEffect, useState } from 'react';
import { id as t } from '@/lib/i18n/id';
import { IconCheck, IconClose } from '@/components/ui/icons';

interface StageSpec {
  afterSec: number;
  title: string;
}

const STAGES: readonly StageSpec[] = [
  { afterSec: 0, title: t.scan.step1Title },
  { afterSec: 2, title: t.scan.step2Title },
  { afterSec: 6, title: t.scan.step3Title },
  { afterSec: 11, title: t.scan.step4Title },
  { afterSec: 18, title: t.scan.step5Title },
] as const;

export function ScanProgress({
  onCancel,
  active = true,
}: {
  kind?: 'URL' | 'IMAGE';
  onCancel: () => void;
  active?: boolean;
}) {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTicks((n) => n + 1), 200);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const elapsed = ticks * 0.2;

  let currentIdx = 0;
  STAGES.forEach((s, idx) => {
    if (elapsed >= s.afterSec) currentIdx = idx;
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[4px] border border-[var(--accent-border)] bg-[var(--surface-0)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
          />
          <span className="text-[0.875rem] font-semibold text-[var(--foreground)]">
            {t.scan.scanning}
          </span>
          <span className="vk-mono vk-tabular text-[0.78rem] text-[var(--accent-ink)]">
            ({elapsed.toFixed(1)} {t.scan.elapsedUnit})
          </span>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
        >
          <IconClose size={12} />
          <span>{t.scan.cancel}</span>
        </button>
      </div>

      <ol className="grid gap-1.5 sm:grid-cols-5">
        {STAGES.map((stage, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <li
              key={stage.title}
              className={[
                'flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1.5 text-[0.75rem]',
                isCurrent
                  ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] font-semibold text-[var(--foreground)]'
                  : isDone
                    ? 'border-[var(--verdict-safe)]/40 bg-[var(--surface-1)] text-[var(--verdict-safe)]'
                    : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--muted)]',
              ].join(' ')}
            >
              {isDone ? (
                <IconCheck size={12} className="shrink-0" />
              ) : (
                <span className="vk-mono text-[0.6875rem]">{idx + 1}.</span>
              )}
              <span className="truncate">{stage.title}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
