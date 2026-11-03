'use client';

/**
 * Stage-by-stage latency against the 5-second field SLA.
 *
 * This turns a claim in the benchmark report into something visible per scan,
 * and it is genuinely informative: on a typical warm run the detection work is
 * around 1.9s while the Supabase evidence upload accounts for most of the
 * remainder. Showing the split makes clear which part is the engine and which
 * part is the network.
 *
 * Stage keys differ between URL and image scans, so nothing is hardcoded —
 * whatever the engine reports is what gets drawn.
 */

import { id as t } from '@/lib/i18n/id';

const SLA_MS = 5000;

/** Indonesian labels for the stage keys the engine emits. */
const STAGE_LABELS: Record<string, string> = {
  browser_acquire_ms: 'Ambil instance peramban',
  navigation_dom_ms: 'Navigasi & muat DOM',
  render_settle_ms: 'Stabilisasi render',
  screenshot_dom_extract_ms: 'Tangkap layar & ekstrak DOM',
  dom_annotate_ms: 'Anotasi DOM',
  phase1_total_ms: 'Total sandbox (Fase 1)',
  visual_similarity_ms: 'Kemiripan visual (SSIM)',
  logo_detection_ms: 'Deteksi logo',
  scoring_fusion_ms: 'Fusi skor risiko',
  supabase_sync_ms: 'Sinkronisasi Supabase',
  decode_io_ms: 'Dekode berkas gambar',
  ocr_semantics_ms: 'OCR & analisis semantik',
  qr_quishing_ms: 'Pemindaian QR',
  total_ms: 'Total',
};

/** `total_ms` is the sum, not a stage — it is the scale, drawn separately. */
const TOTAL_KEYS = new Set(['total_ms', 'phase1_total_ms']);

export function LatencyWaterfall({ latencyMs }: { latencyMs: Record<string, number> }) {
  const entries = Object.entries(latencyMs);
  if (entries.length === 0) return null;

  const total = latencyMs.total_ms ?? entries.reduce((sum, [k, v]) => (TOTAL_KEYS.has(k) ? sum : sum + v), 0);
  const stages = entries
    .filter(([k, v]) => !TOTAL_KEYS.has(k) && v > 0)
    .sort((a, b) => b[1] - a[1]);

  // The bar scale runs to whichever is larger, so an over-SLA scan still fits.
  const scale = Math.max(total, SLA_MS);
  const overSla = total > SLA_MS;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{t.forensics.latency}</h2>
        <span
          className="vk-mono text-sm font-semibold tabular-nums"
          style={{ color: overSla ? 'var(--verdict-suspicious)' : 'var(--verdict-safe)' }}
        >
          {(total / 1000).toFixed(2)} dtk
        </span>
        <span className="text-xs text-[var(--muted)]">
          target SLA {SLA_MS / 1000} dtk {overSla ? '— terlampaui' : '— terpenuhi'}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {stages.map(([key, ms]) => {
          const pct = (ms / scale) * 100;
          // The network leg is coloured apart from the engine's own work:
          // they are very different things to an operator reading this.
          const isNetwork = key === 'supabase_sync_ms';
          return (
            <li key={key} className="grid grid-cols-[11rem_1fr_4.5rem] items-center gap-3 text-xs">
              <span className="truncate text-[var(--muted-strong)]">
                {STAGE_LABELS[key] ?? key}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: isNetwork ? 'var(--muted)' : 'var(--accent-bright)',
                  }}
                />
              </span>
              <span className="vk-mono text-right tabular-nums text-[var(--muted-strong)]">
                {ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`}
              </span>
            </li>
          );
        })}
      </ul>

      {latencyMs.supabase_sync_ms > 0 && (
        <p className="mt-2.5 border-t border-[var(--border)] pt-2 text-[0.7rem] leading-snug text-[var(--muted)]">
          Batang abu-abu adalah unggahan bukti ke penyimpanan pusat (jaringan), bukan waktu
          komputasi mesin deteksi.
        </p>
      )}
    </section>
  );
}
