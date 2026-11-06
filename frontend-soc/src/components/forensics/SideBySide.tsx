'use client';

/**
 * Visual diff comparator between the suspect artifact and the genuine .mil.id
 * portal it impersonates.
 *
 * Designed as an authentic diff tool:
 *   1. Interactive pointer-drag split curtain ("Tirai Diff Geser") with top
 *      provenance badges and instant 0% / 25% / 50% / 75% / 100% split presets.
 *   2. Dual-frame side-by-side diff ("Sandingkan Dua Panel") with top header bars
 *      (never captions below images).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findPortal,
  getReferencePortals,
  referencePortalImage,
  type ReferencePortal,
} from '@/lib/api/endpoints';
import { engineUrl } from '@/lib/api/client';
import { formatScore } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';
import {
  IconOctagonAlert,
  IconShieldCheck,
  IconSplitDiff,
  VerdictIcon,
} from '@/components/ui/icons';

type DiffMode = 'curtain' | 'side';

const SPLIT_PRESETS = [0, 25, 50, 75, 100] as const;

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
  const [failedTarget, setFailedTarget] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>('curtain');
  const [wipe, setWipe] = useState(50);
  const [dragging, setDragging] = useState(false);
  const curtainRef = useRef<HTMLDivElement>(null);

  const failed = Boolean(impersonatedTarget && failedTarget === impersonatedTarget);

  useEffect(() => {
    if (!impersonatedTarget) return;
    let cancelled = false;

    void getReferencePortals()
      .then((r) => {
        if (!cancelled) setPortal(findPortal(r.portals, impersonatedTarget));
      })
      .catch(() => {
        if (!cancelled) setFailedTarget(impersonatedTarget);
      });

    return () => {
      cancelled = true;
    };
  }, [impersonatedTarget]);

  const referenceUrl = useMemo(
    () => (portal ? engineUrl(referencePortalImage(portal.id)) : null),
    [portal],
  );

  const updateWipeFromClientX = useCallback((clientX: number) => {
    const el = curtainRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setWipe(Math.round(pct));
  }, []);

  const scoreBand = bandOf(visualScore);
  const scoreColor = `var(${VERDICT_VAR[scoreBand]})`;

  if (!impersonatedTarget) {
    return (
      <div className="vk-bento min-w-0 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            {t.forensics.reference}
          </h3>
          <span
            className="vk-mono vk-tabular inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.8125rem] font-semibold"
            style={{
              color: scoreColor,
              borderColor: `color-mix(in srgb, ${scoreColor} 35%, transparent)`,
              background: `color-mix(in srgb, ${scoreColor} 10%, transparent)`,
            }}
          >
            <VerdictIcon verdict={scoreBand} size={13} />
            <span>
              {t.forensics.maxSimilarityPrefix} {formatScore(visualScore)}%
            </span>
          </span>
        </div>
        <div className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--muted-strong)]">
          {t.forensics.noReference}
        </div>
      </div>
    );
  }

  return (
    <div className="vk-bento min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            {t.forensics.reference}
          </h3>
          <span
            className="vk-mono vk-tabular inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[0.8125rem] font-semibold"
            style={{
              color: scoreColor,
              borderColor: `color-mix(in srgb, ${scoreColor} 38%, transparent)`,
              background: `color-mix(in srgb, ${scoreColor} 11%, transparent)`,
            }}
          >
            <VerdictIcon verdict={scoreBand} size={14} />
            <span>
              {t.forensics.similarityBadgePrefix}: {formatScore(visualScore)}%
            </span>
          </span>
        </div>

        {referenceUrl && (
          <div className="vk-no-print flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            {(['curtain', 'side'] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={active}
                  className={[
                    'rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
                    active
                      ? 'bg-[var(--accent-tint)] text-[var(--foreground)]'
                      : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                  ].join(' ')}
                >
                  {m === 'curtain' ? t.forensics.splitModeCurtain : t.forensics.splitModeSide}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-[0.8125rem]">
        <span className="text-[var(--muted)]">{t.forensics.impersonatingPrefix}</span>
        <span className="font-semibold text-[var(--foreground)]">{impersonatedTarget}</span>
        {portal && (
          <span className="vk-mono text-[var(--verdict-safe)]">· {portal.official_domain}</span>
        )}
      </div>

      {!referenceUrl ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-[0.875rem] text-[var(--muted-strong)]">
          {failed ? t.forensics.failedReference : t.forensics.loadingReference}
        </div>
      ) : mode === 'curtain' ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {/* Top Diff Header Strip + Split Presets (zero range inputs, zero captions below) */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[0.8125rem]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--verdict-critical)]">
              <IconOctagonAlert size={14} />
              <span>{t.forensics.suspectFrameLabel}</span>
            </span>

            <div className="vk-no-print flex items-center gap-1">
              <span className="mr-1 text-[var(--muted)]">{t.forensics.curtainPresetLabel}</span>
              {SPLIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setWipe(preset)}
                  aria-pressed={wipe === preset}
                  className={[
                    'vk-mono vk-tabular rounded border px-2 py-0.5 text-[0.8125rem] font-medium transition-colors',
                    wipe === preset
                      ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                      : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                  ].join(' ')}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--verdict-safe)]">
              <IconShieldCheck size={14} />
              <span>{t.forensics.officialFrameLabel}</span>
            </span>
          </div>

          <div
            ref={curtainRef}
            tabIndex={0}
            role="group"
            aria-label={t.forensics.curtainDragAria}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setWipe((v) => Math.max(0, v - 5));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setWipe((v) => Math.min(100, v + 5));
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
              updateWipeFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging) updateWipeFromClientX(e.clientX);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className="relative cursor-ew-resize select-none overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--canvas)]"
          >
            {/* Base layer: genuine official reference portal */}
            {/* eslint-disable-next-line @next/next/no-img-element -- served from engine */}
            <img
              src={referenceUrl}
              alt={`${t.forensics.portalOfficialAltPrefix} ${portal?.portal_name ?? ''}`}
              referrerPolicy="no-referrer"
              draggable={false}
              className="block w-full"
              onError={() => setFailedTarget(impersonatedTarget)}
            />

            {/* Clipped top layer: suspect phishing page */}
            {evidenceUrl && (
              <div
                className="absolute inset-0"
                style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- runtime evidence host */}
                <img
                  src={evidenceUrl}
                  alt={t.forensics.evidenceAlt}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="block h-full w-full object-cover"
                />
              </div>
            )}

            {/* Optical Curtain Seam & Reticle Handle */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-[var(--accent-ink)]"
              style={{ left: `${wipe}%` }}
            >
              <span className="absolute top-1/2 left-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--accent-ink)] bg-[var(--surface-0)] text-[var(--accent-ink)]">
                <IconSplitDiff size={15} />
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-[var(--verdict-critical)]/45 bg-[var(--canvas)]">
            <div className="flex items-center gap-1.5 border-b border-[var(--verdict-critical)]/35 bg-[var(--surface-2)] px-3 py-2 text-[0.8125rem] font-semibold text-[var(--verdict-critical)]">
              <IconOctagonAlert size={14} />
              <span>{t.forensics.suspectFrameLabel}</span>
            </div>
            {evidenceUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- runtime evidence host */
              <img
                src={evidenceUrl}
                alt={t.forensics.evidenceAlt}
                referrerPolicy="no-referrer"
                className="block w-full"
              />
            ) : (
              <div className="p-4 text-[0.8125rem] text-[var(--muted)]">
                {t.forensics.noVisualEvidence}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--verdict-safe)]/45 bg-[var(--canvas)]">
            <div className="flex items-center gap-1.5 border-b border-[var(--verdict-safe)]/35 bg-[var(--surface-2)] px-3 py-2 text-[0.8125rem] font-semibold text-[var(--verdict-safe)]">
              <IconShieldCheck size={14} />
              <span>{t.forensics.officialFrameLabel}</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- served from engine */}
            <img
              src={referenceUrl}
              alt={`${t.forensics.portalOfficialAltPrefix} ${portal?.portal_name ?? ''}`}
              referrerPolicy="no-referrer"
              className="block w-full"
              onError={() => setFailedTarget(impersonatedTarget)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
