'use client';

/**
 * Root error boundary. A white screen in front of a jury is the worst outcome
 * available, so every route segment that can throw gets one of these.
 */

import { useEffect } from 'react';
import { id } from '@/lib/i18n/id';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[vk] kesalahan tak tertangani', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold text-[var(--verdict-critical)]">{id.common.error}</h2>
      <p className="mt-2 text-sm text-[var(--muted-strong)]">
        Antarmuka mengalami kesalahan dan tidak dapat menampilkan bagian ini.
      </p>
      <pre className="vk-mono mt-3 overflow-x-auto rounded bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
        {error.message}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        {id.common.retry}
      </button>
    </div>
  );
}
