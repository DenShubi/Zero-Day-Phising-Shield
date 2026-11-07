'use client';

/**
 * Horizontal 5-stage scan progress ledger designed for conference projector
 * legibility and calm operational telemetry.
 */

import { useEffect, useState } from 'react';
import { id as t } from '@/lib/i18n/id';
import { IconCheck, IconClose } from '@/components/ui/icons';

const SLA_SECONDS = 5;

interface StageSpec {
  afterSec: number;
  title: string;
  urlDetail: string;
  imageDetail: string;
}

const STAGES: readonly StageSpec[] = [
  {
    afterSec: 0,
    title: t.scan.step1Title,
    urlDetail: t.scan.step1Url,
    imageDetail: t.scan.step1Img,
  },
  {
    afterSec: 2,
    title: t.scan.step2Title,
    urlDetail: t.scan.step2Url,
    imageDetail: t.scan.step2Img,
  },
  {
    afterSec: 6,
    title: t.scan.step3Title,
    urlDetail: t.scan.step3Url,
    imageDetail: t.scan.step3Img,
  },
  {
    afterSec: 11,
    title: t.scan.step4Title,
    urlDetail: t.scan.step4Url,
    imageDetail: t.scan.step4Img,
  },
  {
    afterSec: 18,
    title: t.scan.step5Title,
    urlDetail: t.scan.step5Url,
    imageDetail: t.scan.step5Img,
  },
] as const;

export function ScanProgress({
  kind,
  startedAt,
  onCancel,
  active = true,
}: {
  kind: 'URL' | 'IMAGE';
  startedAt: number;
  onCancel: () => void;
  active?: boolean;
}) {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  const elapsed =
    active && startedAt > 0 && nowMs >= startedAt ? (nowMs - startedAt) / 1000 : 0;

  let currentIdx = -1;
  if (active) {
    currentIdx = 0;
    STAGES.forEach((s, idx) => {
      if (elapsed >= s.afterSec) currentIdx = idx;
    });
  }

  const currentStage = currentIdx >= 0 ? STAGES[currentIdx] : null;
  const overSla = active && elapsed > SLA_SECONDS;

  return (
    <div
      className="min-w-0 bg-[var(--surface-0)] p-4 sm:p-5"
      role={active ? 'status' : undefined}
      aria-live={active ? 'polite' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="vk-pane-label text-[var(--foreground)]">{t.scan.pipelineReadyTitle}</h2>
          <p className="mt-0.5 text-[0.8125rem] text-[var(--muted-strong)]">
            {active && currentStage
              ? kind === 'URL'
                ? currentStage.urlDetail
                : currentStage.imageDetail
              : t.scan.autoOpenNotice}
          </p>
        </div>

        {active && (
          <div className="flex items-center gap-3">
            <div
              className="vk-mono vk-tabular text-[1.5rem] leading-none font-semibold tracking-[-0.025em]"
              style={{ color: overSla ? 'var(--verdict-suspicious)' : 'var(--accent-ink)' }}
            >
              {elapsed.toFixed(1)}
              <span className="ml-1 text-[0.75rem] font-normal text-[var(--muted)]">
                {t.scan.elapsedUnit}
              </span>
            </div>

            <button
              type="button"
              onClick={onCancel}
              className="vk-btn vk-btn-secondary h-8 px-3 text-[0.8125rem]"
            >
              <IconClose size={13} />
              <span>{t.scan.cancel}</span>
            </button>
          </div>
        )}
      </div>

      <ol className="mt-3 grid divide-y divide-[var(--border)] rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)] sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {STAGES.map((stage, idx) => {
          const isDone = active && idx < currentIdx;
          const isCurrent = active && idx === currentIdx;
          return (
            <li
              key={stage.title}
              className={[
                'flex flex-col justify-between px-3 py-2.5 transition-colors duration-100',
                isCurrent
                  ? 'bg-[var(--accent-tint)]'
                  : isDone
                    ? 'bg-[var(--surface-2)]'
                    : 'bg-[var(--surface-1)]',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    'vk-mono vk-tabular text-[0.75rem] font-semibold',
                    isCurrent
                      ? 'text-[var(--accent-ink)]'
                      : isDone
                        ? 'text-[var(--verdict-safe)]'
                        : 'text-[var(--muted)]',
                  ].join(' ')}
                >
                  0{idx + 1}
                </span>
                {isDone && (
                  <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                    <IconCheck size={13} />
                  </span>
                )}
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
                  />
                )}
              </div>
              <div
                className={[
                  'mt-1.5 text-[0.8125rem] font-medium leading-snug',
                  isCurrent || isDone ? 'text-[var(--foreground)]' : 'text-[var(--muted-strong)]',
                ].join(' ')}
              >
                {stage.title}
              </div>
            </li>
          );
        })}
      </ol>

      {overSla && (
        <p className="mt-2.5 text-[0.75rem] text-[var(--muted)]">{t.scan.overSlaNote}</p>
      )}
    </div>
  );
}
