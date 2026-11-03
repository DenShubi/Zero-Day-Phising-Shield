'use client';

/**
 * What the engine read out of an image: decoded QR payloads, OCR-extracted
 * URLs, the OCR text snippet, and the count of login-shaped boxes it found in
 * a static screenshot that has no DOM to inspect.
 *
 * QR payloads are treated as hostile input. They are rendered as text with the
 * defang toggle applied — a decoded payload can be a javascript: URI, and a
 * SOC console must never make one clickable.
 */

import { defang, truncateMiddle } from '@/lib/format';
import type { ImageScanExtras } from '@/lib/normalize';
import { boxIdForQr } from './boxes';

const LAYOUT_LABEL: Record<string, string> = {
  POSTER_FLYER: 'Poster / selebaran',
  MOBILE_SCREENSHOT: 'Tangkapan layar ponsel',
  WEB_SCREENSHOT: 'Tangkapan layar web',
  GENERAL_IMAGE: 'Gambar umum',
};

export function MultimodalPanel({
  image,
  highlightedId,
  onHighlight,
  defanged,
}: {
  image: ImageScanExtras;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  defanged: boolean;
}) {
  const show = (value: string) => (defanged ? defang(value) : value);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Analisis Multimodal (OCR &amp; QR)
      </h2>

      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="text-[var(--muted)]">Jenis konten:</dt>
          <dd className="text-[var(--muted-strong)]">
            {LAYOUT_LABEL[image.layoutType ?? ''] ?? image.layoutType ?? 'tidak diketahui'}
          </dd>
        </div>
        {image.visualInputBoxesCount > 0 && (
          <div className="flex gap-1.5">
            <dt className="text-[var(--muted)]">Kotak input terdeteksi:</dt>
            <dd className="vk-mono text-[var(--layer-form)]">{image.visualInputBoxesCount}</dd>
          </div>
        )}
      </dl>

      {image.qrCodes.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            QR code terbaca ({image.qrCodes.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {image.qrCodes.map((qr, i) => {
              const boxId = boxIdForQr(i);
              const active = highlightedId === boxId;
              return (
                <li
                  key={boxId}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  className="rounded border px-2.5 py-2 transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-qr)' : 'var(--border)',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-qr) 12%, transparent)'
                      : 'var(--surface-raised)',
                  }}
                >
                  <p className="vk-mono break-all text-xs text-[var(--foreground)]">
                    {show(qr.payload)}
                  </p>
                  {qr.decoder && (
                    <p className="mt-0.5 text-[0.7rem] text-[var(--muted)]">
                      dekoder: {qr.decoder}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {image.extractedUrls.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Tautan terbaca OCR ({image.extractedUrls.length})
          </h3>
          <ul className="flex flex-col gap-0.5">
            {image.extractedUrls.map((link) => (
              <li key={link} className="vk-mono break-all text-xs text-[var(--muted-strong)]">
                {show(link)}
              </li>
            ))}
          </ul>
          {/* OCR output is noisy by nature; saying so prevents a misread
              character being taken as a confirmed indicator. */}
          <p className="mt-1 text-[0.7rem] text-[var(--muted)]">
            Hasil OCR dapat mengandung galat pembacaan karakter — verifikasi sebelum dijadikan
            indikator blokir.
          </p>
        </div>
      )}

      {image.ocrTextSnippet && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Cuplikan teks OCR
          </h3>
          {/* Attacker-controlled text: escaped by React, never injected as HTML. */}
          <p className="rounded bg-[var(--surface-raised)] px-2.5 py-2 text-xs leading-relaxed text-[var(--muted-strong)]">
            {truncateMiddle(image.ocrTextSnippet, 400)}
          </p>
        </div>
      )}
    </section>
  );
}
