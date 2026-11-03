'use client';

/**
 * Engine + database reachability, and the runtime backend-URL override.
 *
 * The override matters more than it looks: a Cloudflare quick tunnel hands out
 * a new hostname every restart, and NEXT_PUBLIC_* is baked at build time, so
 * without this a tunnel change would mean a rebuild and redeploy mid-demo.
 *
 * Every storage and location read happens inside an effect behind a `mounted`
 * gate. A "use client" page is still prerendered at build time, so touching
 * localStorage during render would break `next build`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackendUrl, setBackendUrl } from '@/lib/api/client';
import { getHealth, getSupabaseStatus } from '@/lib/api/endpoints';
import { id } from '@/lib/i18n/id';

type Probe = 'checking' | 'up' | 'down';

const POLL_MS = 15_000;

function Dot({ state }: { state: Probe }) {
  const color =
    state === 'up'
      ? 'var(--verdict-safe)'
      : state === 'down'
        ? 'var(--verdict-critical)'
        : 'var(--muted)';
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function HealthStrip() {
  const [mounted, setMounted] = useState(false);
  const [engine, setEngine] = useState<Probe>('checking');
  const [db, setDb] = useState<Probe>('checking');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [current, setCurrent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const probe = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const h = await getHealth(ac.signal);
      if (ac.signal.aborted) return;
      setEngine(h.status === 'healthy' ? 'up' : 'down');
      // Only ask about the database once the engine itself answered.
      try {
        const s = await getSupabaseStatus(ac.signal);
        if (!ac.signal.aborted) setDb(s.connected ? 'up' : 'down');
      } catch {
        if (!ac.signal.aborted) setDb('down');
      }
    } catch {
      if (!ac.signal.aborted) {
        setEngine('down');
        setDb('down');
      }
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const url = getBackendUrl();
    setCurrent(url);
    setDraft(url);

    void probe();
    const timer = setInterval(() => void probe(), POLL_MS);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [probe]);

  const apply = () => {
    setBackendUrl(draft.trim() === '' ? null : draft);
    const next = getBackendUrl();
    setCurrent(next);
    setDraft(next);
    setOpen(false);
    setEngine('checking');
    setDb('checking');
    void probe();
  };

  const reset = () => {
    setBackendUrl(null);
    const next = getBackendUrl();
    setCurrent(next);
    setDraft(next);
    setEngine('checking');
    setDb('checking');
    void probe();
  };

  // Render a stable placeholder until mounted, so markup matches the prerender.
  if (!mounted) {
    return (
      <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
        <span>{id.health.checking}</span>
      </div>
    );
  }

  const label = (state: Probe) =>
    state === 'up' ? id.health.online : state === 'down' ? id.health.offline : id.health.checking;

  return (
    <div className="relative flex items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5 text-[var(--muted-strong)]">
        <Dot state={engine} />
        {id.health.engine}: {label(engine)}
      </span>
      <span className="flex items-center gap-1.5 text-[var(--muted-strong)]">
        <Dot state={db} />
        {id.health.database}: {label(db)}
      </span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface-raised)]"
      >
        {id.health.backendUrl}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-[22rem] rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-xl">
          <label htmlFor="vk-backend-url" className="block text-xs text-[var(--muted-strong)]">
            {id.health.backendUrl}
          </label>
          <input
            id="vk-backend-url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
              if (e.key === 'Escape') setOpen(false);
            }}
            spellCheck={false}
            className="vk-mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]"
            placeholder="http://localhost:8000"
          />
          <p className="mt-2 text-[0.7rem] leading-snug text-[var(--muted)]">
            {id.health.backendUrlHint}
          </p>
          <p className="vk-mono mt-1 text-[0.7rem] text-[var(--muted)]">aktif: {current}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={apply}
              className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white"
            >
              {id.health.save}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-strong)]"
            >
              {id.health.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
