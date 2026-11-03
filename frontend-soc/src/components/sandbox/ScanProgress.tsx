'use client';

/**
 * Staged progress for a long synchronous scan.
 *
 * Measured against the current engine: ~14s warm for a local target, ~20s cold,
 * and ~38s for an external site. A bare spinner over that interval reads as a
 * hung page, so this names the stage the engine is plausibly in and counts the
 * elapsed seconds, which makes a slow scan legible rather than alarming.
 *
 * The stages are indicative, not reported by the engine — there is no progress
 * channel, so they are driven on a timer and labelled honestly. The elapsed
 * counter is the real measurement, and the SLA marker shows when a scan has run
 * past the 5s field target.
 */

import { useEffect, useState } from 'react';

const SLA_SECONDS = 5;

interface Stage {
  afterSec: number;
  urlLabel: string;
  imageLabel: string;
}

const STAGES: Stage[] = [
  { afterSec: 0, urlLabel: 'Menyiapkan sandbox terisolasi…', imageLabel: 'Mengunggah berkas…' },
  { afterSec: 2, urlLabel: 'Membuka target di Chromium headless…', imageLabel: 'Membaca teks (OCR)…' },
  { afterSec: 6, urlLabel: 'Mengekstrak DOM & menangkap layar…', imageLabel: 'Memindai QR code…' },
  { afterSec: 11, urlLabel: 'Menghitung kemiripan visual & logo…', imageLabel: 'Mencocokkan logo resmi…' },
  { afterSec: 18, urlLabel: 'Menyusun skor risiko & sinkronisasi…', imageLabel: 'Menyusun skor risiko…' },
];

export function ScanProgress({
  kind,
  startedAt,
  onCancel,
}: {
  kind: 'URL' | 'IMAGE';
  startedAt: number;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => setElapsed((Date.now() - startedAt) / 1000);
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  const stage = [...STAGES].reverse().find((s) => elapsed >= s.afterSec) ?? STAGES[0];
  const label = kind === 'URL' ? stage.urlLabel : stage.imageLabel;
  const overSla = elapsed > SLA_SECONDS;

  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-bright)]"
        />
        <span className="flex-1 text-sm text-[var(--foreground)]">{label}</span>
        <span
          className="vk-mono text-sm tabular-nums"
          style={{ color: overSla ? 'var(--verdict-suspicious)' : 'var(--muted-strong)' }}
        >
          {elapsed.toFixed(1)} dtk
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface)]"
        >
          Batalkan
        </button>
      </div>

      {overSla && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Melewati target SLA {SLA_SECONDS} detik. Pemindaian pertama termasuk pemanasan Chromium,
          dan target eksternal bergantung pada latensi jaringan.
        </p>
      )}
    </div>
  );
}
