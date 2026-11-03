'use client';

/**
 * The impersonated page against the genuine portal it copies.
 *
 * Two views of the same comparison:
 *   - side by side, for reading detail and for the submission screenshot;
 *   - an overlay slider, which is the version that lands on a projector —
 *     dragging the handle wipes between fake and real in the same frame.
 *
 * The reference image comes from /static/reference/<id>.png, which the engine
 * already serves from its reference_db. Nothing new is needed server-side.
 *
 * This is submission screenshot #2 (side-by-side visual forensics).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findPortal,
  getReferencePortals,
  referencePortalImage,
  type ReferencePortal,
} from '@/lib/api/endpoints';
import { engineUrl } from '@/lib/api/client';
import { formatScore } from '@/lib/format';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';

type View = 'split' | 'slider';

export function SideBySide({
  evidenceUrl,
  impersonatedTarget,
  visualScore,
}: {
  evidenceUrl: string | null;
  impersonatedTarget: string | null;
  visualScore: number;
}) {
  const [portal, setPortal] = useState<ReferencePortal | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>('split');
  const [wipe, setWipe] = useState(50);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!impersonatedTarget) return;
    let cancelled = false;

    void getReferencePortals()
      .then((r) => {
        if (!cancelled) setPortal(findPortal(r.portals, impersonatedTarget));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [impersonatedTarget]);

  const referenceUrl = useMemo(
    () => (portal ? engineUrl(referencePortalImage(portal.id)) : null),
    [portal],
  );

  // No impersonation detected: the similarity figure alone is the finding,
  // and an empty comparison frame would imply a match that was not made.
  if (!impersonatedTarget) {
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Pembanding Portal Resmi
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Tidak ada portal resmi yang cocok untuk dibandingkan — mesin tidak menemukan indikasi
          peniruan tata letak.
        </p>
        <p className="mt-2 text-xs text-[var(--muted-strong)]">
          Kemiripan visual tertinggi:{' '}
          <span className="vk-mono" style={{ color: `var(${VERDICT_VAR[bandOf(visualScore)]})` }}>
            {formatScore(visualScore)}%
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Pembanding Portal Resmi
        </h2>
        <span
          className="vk-mono text-xs font-semibold"
          style={{ color: `var(${VERDICT_VAR[bandOf(visualScore)]})` }}
        >
          kemiripan {formatScore(visualScore)}%
        </span>
        {referenceUrl && (
          <div className="vk-no-print ml-auto flex gap-1">
            {(['split', 'slider'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={[
                  'rounded px-2 py-1 text-xs transition-colors',
                  view === v
                    ? 'bg-[var(--accent)]/20 text-[var(--accent-bright)]'
                    : 'text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]',
                ].join(' ')}
              >
                {v === 'split' ? 'Berdampingan' : 'Geser'}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-[var(--muted)]">
        Terindikasi meniru: <span className="text-[var(--muted-strong)]">{impersonatedTarget}</span>
        {portal && <span className="vk-mono"> · {portal.official_domain}</span>}
      </p>

      {!referenceUrl ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {failed
            ? 'Daftar portal rujukan tidak dapat dimuat dari mesin.'
            : 'Mencari tangkapan layar portal rujukan…'}
        </p>
      ) : view === 'split' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <figure className="m-0">
            <figcaption className="mb-1 text-xs font-semibold text-[var(--verdict-critical)]">
              Halaman diperiksa (palsu)
            </figcaption>
            {evidenceUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- evidence host varies at runtime */
              <img
                src={evidenceUrl}
                alt="Tangkapan layar halaman yang diperiksa"
                referrerPolicy="no-referrer"
                className="w-full rounded border border-[var(--verdict-critical)]/40"
              />
            ) : (
              <p className="text-xs text-[var(--muted)]">Tidak ada bukti visual.</p>
            )}
          </figure>
          <figure className="m-0">
            <figcaption className="mb-1 text-xs font-semibold text-[var(--verdict-safe)]">
              Portal resmi (rujukan)
            </figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the engine */}
            <img
              src={referenceUrl}
              alt={`Tangkapan layar portal resmi ${portal?.portal_name ?? ''}`}
              referrerPolicy="no-referrer"
              className="w-full rounded border border-[var(--verdict-safe)]/40"
              onError={() => setFailed(true)}
            />
          </figure>
        </div>
      ) : (
        <div className="mt-3">
          <div
            ref={sliderRef}
            className="relative overflow-hidden rounded border border-[var(--border)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the engine */}
            <img
              src={referenceUrl}
              alt={`Portal resmi ${portal?.portal_name ?? ''}`}
              referrerPolicy="no-referrer"
              className="block w-full"
            />
            {evidenceUrl && (
              <div
                className="absolute inset-0"
                // clip-path is the whole trick: one image laid over the other,
                // revealed progressively. No canvas, no measurement.
                style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- evidence host varies at runtime */}
                <img
                  src={evidenceUrl}
                  alt="Halaman yang diperiksa"
                  referrerPolicy="no-referrer"
                  className="block h-full w-full object-cover"
                />
              </div>
            )}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--accent-bright)]"
              style={{ left: `${wipe}%` }}
            />
          </div>

          <label className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="text-[var(--verdict-critical)]">palsu</span>
            <input
              type="range"
              min={0}
              max={100}
              value={wipe}
              onChange={(e) => setWipe(Number(e.target.value))}
              aria-label="Geser perbandingan antara halaman palsu dan portal resmi"
              className="flex-1"
            />
            <span className="text-[var(--verdict-safe)]">resmi</span>
          </label>
        </div>
      )}
    </section>
  );
}
