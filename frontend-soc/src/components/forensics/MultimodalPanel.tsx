'use client';

/**
 * Multimodal evidence extracted from static posters and screenshots:
 * decoded QR quishing payloads, OCR-extracted URLs, OCR text snippet, and
 * visual login-box counts.
 */

import { defang, truncateMiddle } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import type { ImageScanExtras } from '@/lib/normalize';
import { IconAlertTriangle } from '@/components/ui/icons';
import { boxIdForQr } from './boxes';

const LAYOUT_LABEL: Record<string, string> = {
  POSTER_FLYER: t.forensics.layoutPoster,
  MOBILE_SCREENSHOT: t.forensics.layoutMobile,
  WEB_SCREENSHOT: t.forensics.layoutWeb,
  GENERAL_IMAGE: t.forensics.layoutGeneral,
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
    <div className="min-w-0 p-4">
      <h2 className="vk-pane-label text-[var(--foreground)]">{t.forensics.multimodal}</h2>

      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-[0.8125rem]">
        <div className="flex gap-1.5">
          <dt className="text-[var(--muted)]">{t.forensics.contentTypeLabel}</dt>
          <dd className="font-medium text-[var(--muted-strong)]">
            {LAYOUT_LABEL[image.layoutType ?? ''] ?? image.layoutType ?? t.forensics.unknownLayout}
          </dd>
        </div>
        {image.visualInputBoxesCount > 0 && (
          <div className="flex gap-1.5">
            <dt className="text-[var(--muted)]">{t.forensics.visualBoxesLabel}</dt>
            <dd className="vk-mono vk-tabular font-semibold text-[var(--layer-form)]">
              {image.visualInputBoxesCount}
            </dd>
          </div>
        )}
      </dl>

      {image.qrCodes.length > 0 && (
        <div className="mt-3">
          <h3 className="vk-pane-label mb-1.5">
            {t.forensics.qrHeader} ({image.qrCodes.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {image.qrCodes.map((qr, i) => {
              const boxId = boxIdForQr(i);
              const active = highlightedId === boxId;
              return (
                <li
                  key={boxId}
                  tabIndex={0}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(boxId)}
                  onBlur={() => onHighlight(null)}
                  onClick={() => onHighlight(active ? null : boxId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onHighlight(active ? null : boxId);
                    }
                  }}
                  className="cursor-pointer rounded-[var(--r-sm)] border px-3 py-2 transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-qr)' : 'var(--border)',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-qr) 14%, transparent)'
                      : 'var(--surface-0)',
                  }}
                >
                  <div className="vk-mono break-all text-[0.75rem] text-[var(--foreground)]">
                    {show(qr.payload)}
                  </div>
                  {qr.decoder && (
                    <div className="vk-mono mt-1 text-[0.72rem] text-[var(--muted)]">
                      {t.forensics.decoderPrefix} {qr.decoder}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {image.extractedUrls.length > 0 && (
        <div className="mt-3">
          <h3 className="vk-pane-label mb-1.5">
            {t.forensics.ocrUrlsHeader} ({image.extractedUrls.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {image.extractedUrls.map((link) => (
              <li
                key={link}
                className="vk-mono break-all text-[0.75rem] text-[var(--muted-strong)]"
              >
                {show(link)}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-[var(--verdict-suspicious)]">
            <IconAlertTriangle size={12} />
            <span>{t.forensics.ocrCaveat.trim()}</span>
          </div>
        </div>
      )}

      {image.ocrTextSnippet && (
        <div className="mt-3">
          <h3 className="vk-pane-label mb-1.5">{t.forensics.ocrSnippetHeader}</h3>
          <div className="rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-[var(--muted-strong)]">
            {truncateMiddle(image.ocrTextSnippet, 400)}
          </div>
        </div>
      )}
    </div>
  );
}
