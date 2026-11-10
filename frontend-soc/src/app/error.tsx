'use client';

/**
 * Root error boundary so an unexpected runtime exception never produces a blank screen.
 */

import { useEffect } from 'react';
import { id } from '@/lib/i18n/id';
import { IconOctagonAlert, IconRefresh } from '@/components/ui/icons';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[vk] unhandled UI error', error);
  }, [error]);

  return (
    <section className="vk-panel-section p-4 sm:p-6">
      <div className="mx-auto my-auto w-full max-w-xl rounded-[var(--r-md)] border border-[var(--border-strong)] bg-[var(--surface-0)] p-6">
        <div className="flex items-center gap-2 text-[var(--verdict-critical)]">
          <IconOctagonAlert size={18} />
          <h1
            id="vk-main-heading"
            tabIndex={-1}
            className="text-[1.25rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none"
          >
            {id.errors.crashTitle}
          </h1>
        </div>
        <p className="mt-2 text-[0.875rem] leading-[1.55] text-[var(--muted-strong)]">
          {id.errors.crashBody}
        </p>
        <pre className="vk-mono mt-3 overflow-x-auto rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--canvas)] p-3 text-[0.75rem] text-[var(--muted-strong)]">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={reset}
          className="vk-btn vk-btn-primary mt-4 h-9 px-4 text-[0.8125rem]"
        >
          <IconRefresh size={14} />
          <span>{id.common.retry}</span>
        </button>
      </div>
    </section>
  );
}
