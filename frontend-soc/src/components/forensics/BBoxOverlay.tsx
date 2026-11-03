'use client';

/**
 * Interactive bounding-box layer drawn over the RAW evidence screenshot.
 *
 * The engine also burns boxes into `annotated_bbox_url`. We render a live layer
 * instead of showing only that image, because a live layer can be toggled per
 * category, hovered, and cross-highlighted against the DOM telemetry tables —
 * which makes the page an analysis tool rather than a picture. The burned-in
 * image stays available as a toggle, and is the primary render when a cold
 * incident has no per-element boxes.
 *
 * COORDINATE SPACE — the important part, verified empirically on 2026-11-03:
 *
 *   URL scans   1280x720 always. app/sandbox/browser.py:494 captures with
 *               full_page=False into a fixed viewport.
 *   Image scans the uploaded image's OWN pixel space. Proven by rescaling one
 *               poster: at 1280x720 its QR box was {x:897,y:337,w:227,h:227};
 *               at 800x450 it was {x:560,y:210,w:142,h:142} — exactly 0.625x.
 *
 * So there is no safe default and `sourceSpace` is required. For image scans it
 * comes from the <img>'s naturalWidth/naturalHeight once loaded. Boxes are then
 * positioned in percentages, which keeps them correct at any rendered size with
 * no ResizeObserver and no hydration mismatch.
 */

import { useId, useMemo, useState } from 'react';
import {
  LAYER_LABEL,
  LAYER_VAR,
  type OverlayLayer,
} from '@/lib/verdict';
import type { BBox, SourceSpace } from '@/lib/normalize';

export interface OverlayBox {
  id: string;
  layer: OverlayLayer;
  bbox: BBox;
  /** Short label drawn on the box, e.g. a brand name or field name. */
  label: string;
  /** Longer text for the tooltip / detail line. */
  detail?: string;
}

export interface BBoxOverlayProps {
  imageUrl: string;
  /** Required: see the coordinate-space note above. */
  sourceSpace: SourceSpace | null;
  boxes: readonly OverlayBox[];
  /** Id of a box highlighted from elsewhere, e.g. a hovered telemetry row. */
  highlightedId?: string | null;
  onHighlight?: (id: string | null) => void;
  /** Reports naturalWidth/Height so an image scan can learn its own space. */
  onImageLoad?: (space: SourceSpace) => void;
  alt?: string;
}

const ALL_LAYERS: readonly OverlayLayer[] = ['logo', 'qr', 'form', 'input'];

export function BBoxOverlay({
  imageUrl,
  sourceSpace,
  boxes,
  highlightedId = null,
  onHighlight,
  onImageLoad,
  alt = 'Bukti tangkapan layar',
}: BBoxOverlayProps) {
  const [hidden, setHidden] = useState<ReadonlySet<OverlayLayer>>(() => new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const captionId = useId();

  // Only layers actually present get a toggle, so the legend reflects reality.
  const presentLayers = useMemo(() => {
    const seen = new Set<OverlayLayer>();
    for (const b of boxes) seen.add(b.layer);
    return ALL_LAYERS.filter((l) => seen.has(l));
  }, [boxes]);

  const visible = useMemo(
    () => boxes.filter((b) => !hidden.has(b.layer)),
    [boxes, hidden],
  );

  const toggle = (layer: OverlayLayer) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  // Percentages, so the overlay is correct at any rendered width.
  const pct = (box: BBox) => {
    if (!sourceSpace || sourceSpace.width <= 0 || sourceSpace.height <= 0) return null;
    return {
      left: `${(box.x / sourceSpace.width) * 100}%`,
      top: `${(box.y / sourceSpace.height) * 100}%`,
      width: `${(box.width / sourceSpace.width) * 100}%`,
      height: `${(box.height / sourceSpace.height) * 100}%`,
    };
  };

  return (
    <figure className="vk-overlay">
      {presentLayers.length > 0 && (
        <div className="vk-overlay__legend" role="group" aria-label="Lapisan anotasi">
          {presentLayers.map((layer) => {
            const off = hidden.has(layer);
            const count = boxes.filter((b) => b.layer === layer).length;
            return (
              <button
                key={layer}
                type="button"
                onClick={() => toggle(layer)}
                aria-pressed={!off}
                className="vk-overlay__legend-item"
                data-off={off || undefined}
                style={{ '--swatch': `var(${LAYER_VAR[layer]})` } as React.CSSProperties}
              >
                <span className="vk-overlay__swatch" aria-hidden="true" />
                {LAYER_LABEL[layer]}
                <span className="vk-overlay__count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* The image sizes the frame; boxes are absolutely positioned against it.
          No fixed aspect ratio — an image scan's source can be any shape. */}
      <div className="vk-overlay__frame">
        {loadFailed ? (
          <p className="vk-overlay__error" role="status">
            Gambar bukti tidak dapat dimuat. Periksa koneksi ke penyimpanan bukti.
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the evidence
                host varies at runtime (Supabase Storage or the engine's /static
                mount), so next/image remotePatterns cannot be configured. */}
            <img
              src={imageUrl}
              alt={alt}
              className="vk-overlay__image"
              referrerPolicy="no-referrer"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  onImageLoad?.({ width: img.naturalWidth, height: img.naturalHeight });
                }
              }}
              onError={() => setLoadFailed(true)}
            />

            {sourceSpace &&
              visible.map((box) => {
                const style = pct(box.bbox);
                if (!style) return null;
                const active = highlightedId === box.id;
                return (
                  <button
                    key={box.id}
                    type="button"
                    className="vk-overlay__box"
                    data-active={active || undefined}
                    style={
                      {
                        ...style,
                        '--stroke': `var(${LAYER_VAR[box.layer]})`,
                      } as React.CSSProperties
                    }
                    onMouseEnter={() => onHighlight?.(box.id)}
                    onMouseLeave={() => onHighlight?.(null)}
                    onFocus={() => onHighlight?.(box.id)}
                    onBlur={() => onHighlight?.(null)}
                    aria-label={`${LAYER_LABEL[box.layer]}: ${box.label}`}
                    title={box.detail ?? box.label}
                  >
                    <span className="vk-overlay__tag">{box.label}</span>
                  </button>
                );
              })}
          </>
        )}
      </div>

      {/* Only meaningful when there is something waiting to be placed. With no
          boxes the dimensions are irrelevant, and saying otherwise suggests the
          page is stuck. */}
      {boxes.length > 0 && !sourceSpace && !loadFailed && (
        <figcaption id={captionId} className="vk-overlay__note">
          Menunggu dimensi gambar untuk menempatkan anotasi…
        </figcaption>
      )}
    </figure>
  );
}
