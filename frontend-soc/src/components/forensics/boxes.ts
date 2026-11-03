/**
 * Turns a NormalizedScan into overlay boxes.
 *
 * Box ids are stable and meaningful (`form-0`, `input-nrp_nik`, `qr-0`) so the
 * DOM telemetry tables can cross-highlight by referencing the same id.
 */

import type { NormalizedScan, SourceSpace } from '@/lib/normalize';
import type { OverlayBox } from './BBoxOverlay';

export const boxIdForForm = (index: number) => `form-${index}`;
export const boxIdForInput = (index: number) => `input-${index}`;
export const boxIdForQr = (index: number) => `qr-${index}`;
export const boxIdForLogo = (index: number) => `logo-${index}`;

export function overlayBoxesFor(scan: NormalizedScan): OverlayBox[] {
  const boxes: OverlayBox[] = [];

  scan.detectedLogos.forEach((logo, i) => {
    if (!logo.bbox) return;
    boxes.push({
      id: boxIdForLogo(i),
      layer: 'logo',
      bbox: logo.bbox,
      label: `${logo.brandName} (${logo.confidence.toFixed(0)}%)`,
      detail: `Atribut resmi terdeteksi dengan keyakinan ${logo.confidence.toFixed(1)}%`,
    });
  });

  if (scan.url) {
    scan.url.forms.forEach((form, i) => {
      if (!form.bbox) return;
      boxes.push({
        id: boxIdForForm(form.index ?? i),
        layer: 'form',
        bbox: form.bbox,
        label: form.isCrossOrigin ? 'FORM EKSFIL' : `FORM #${form.index ?? i}`,
        detail: form.isCrossOrigin
          ? `Mengirim data ke origin lain: ${form.resolvedAction ?? form.action ?? '(tidak diketahui)'}`
          : `${form.method ?? 'GET'} -> ${form.resolvedAction ?? form.action ?? '(tidak diketahui)'}`,
      });
    });

    scan.url.inputs.forEach((input, i) => {
      if (!input.bbox || !input.isSensitiveCredential) return;
      boxes.push({
        id: boxIdForInput(i),
        layer: 'input',
        bbox: input.bbox,
        label: input.name ?? input.id ?? input.type ?? 'input',
        detail: input.placeholder ?? 'Input kredensial sensitif',
      });
    });
  }

  if (scan.image) {
    scan.image.qrCodes.forEach((qr, i) => {
      if (!qr.bbox) return;
      boxes.push({
        id: boxIdForQr(i),
        layer: 'qr',
        bbox: qr.bbox,
        label: 'QR',
        detail: qr.payload,
      });
    });
  }

  return boxes;
}

/**
 * The space a scan's boxes are expressed in.
 *
 * URL scans always report 1280x720 from the normalizer. Image scans return null
 * until the <img> loads, because the boxes use the uploaded file's own pixel
 * dimensions — `measured` is what the overlay reports back via onImageLoad.
 */
export function resolveSourceSpace(
  scan: NormalizedScan,
  measured: SourceSpace | null,
): SourceSpace | null {
  if (scan.kind === 'URL') return scan.sourceSpace;
  return scan.sourceSpace ?? measured;
}

/**
 * True when the scan has no per-element boxes to draw, so the burned-in
 * annotated image should be shown as the primary evidence instead. This is the
 * common case for cold image incidents, whose QR/logo boxes are not persisted.
 */
export function shouldPreferBurnedIn(scan: NormalizedScan, boxes: readonly OverlayBox[]): boolean {
  return boxes.length === 0 && Boolean(scan.annotatedUrl);
}
