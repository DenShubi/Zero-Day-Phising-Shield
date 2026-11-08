'use client';

/**
 * Interactive bounding-box layer drawn over the RAW evidence screenshot.
 *
 * COORDINATE SPACE:
 *   URL scans   1280x720 always (app/sandbox/browser.py captures fixed viewport).
 *   Image scans the uploaded image's OWN pixel space (measured on load).
 *
 * Boxes are positioned in percentages so they remain exact at any rendered width
 * without ResizeObserver or hydration mismatch.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LAYER_LABEL,
  LAYER_VAR,
  type OverlayLayer,
} from '@/lib/verdict';
import type { BBox, SourceSpace } from '@/lib/normalize';
import { id as t } from '@/lib/i18n/id';

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
  alt = t.forensics.evidenceAlt,
}: BBoxOverlayProps) {
  const [hidden, setHidden] = useState<ReadonlySet<OverlayLayer>>(() => new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      onImageLoad?.({ width: el.naturalWidth, height: el.naturalHeight });
    }
  }, [imageUrl, onImageLoad]);

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
    <div className="vk-overlay">
      {(presentLayers.length > 0 || (boxes.length > 0 && !sourceSpace && !loadFailed)) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {presentLayers.length > 0 && (
            <div
              className="vk-overlay__legend"
              role="group"
              aria-label={t.forensics.overlayLayersAria}
            >
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
                    <span>{LAYER_LABEL[layer]}</span>
                    <span className="vk-overlay__count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {boxes.length > 0 && !sourceSpace && !loadFailed && (
            <div className="vk-overlay__note">{t.forensics.overlayWaiting}</div>
          )}
        </div>
      )}

      {/* Image sizes the frame; boxes are percentage-positioned over it. */}
      <div className="vk-overlay__frame">
        {loadFailed ? (
          <div className="vk-overlay__error" role="status">
            {t.forensics.overlayError}
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- evidence host varies at runtime */}
            <img
              ref={imgRef}
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
                const isNearRight = box.bbox.x / sourceSpace.width > 0.55;
                const isNearTop = box.bbox.y / sourceSpace.height < 0.045;
                const tagStyle: React.CSSProperties = {
                  ...(isNearRight
                    ? { right: '-2px', left: 'auto' }
                    : { left: '-2px', right: 'auto' }),
                  ...(isNearTop ? { top: 'auto', bottom: '-1.4rem' } : {}),
                };

                return (
                  <div
                    key={box.id}
                    tabIndex={0}
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onHighlight?.(active ? null : box.id);
                      }
                    }}
                    aria-label={`${LAYER_LABEL[box.layer]}: ${box.label}`}
                    title={box.detail ?? box.label}
                  >
                    <span
                      className="vk-overlay__tag max-w-[14rem] truncate"
                      style={tagStyle}
                    >
                      {box.label}
                    </span>
                  </div>
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}
