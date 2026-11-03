'use client';

/**
 * Preparing an uploaded image for scanning.
 *
 * The dimensions matter beyond file size: an image scan's bounding boxes come
 * back in the SOURCE image's own pixel space (verified by rescaling a poster —
 * at 0.625x the boxes scaled by exactly 0.625). So whatever we send is the
 * coordinate space the overlay must use, and if we downscale we must report the
 * downscaled dimensions, not the original ones.
 */

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;
/** Above this, OCR gains nothing and the upload just costs time on a slow link. */
export const MAX_EDGE = 1600;

export interface PreparedImage {
  file: File;
  /** Object URL for preview. The caller must revoke it. */
  previewUrl: string;
  /** The pixel space the engine will express bounding boxes in. */
  dimensions: { width: number; height: number };
  /** True when the image was re-encoded smaller before upload. */
  downscaled: boolean;
  originalBytes: number;
}

export class ImageRejected extends Error {}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Safari fallback.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageRejected('Berkas gambar tidak dapat dibaca.'));
    };
    img.src = url;
  });
}

/**
 * Validate, measure, and downscale if needed.
 * Throws ImageRejected with an Indonesian message the UI can show directly.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    throw new ImageRejected(
      `Format ${file.type || 'tidak dikenal'} tidak didukung. Gunakan PNG, JPG, atau WebP.`,
    );
  }

  const bitmap = await loadBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (srcW === 0 || srcH === 0) {
    throw new ImageRejected('Dimensi gambar tidak valid.');
  }

  const longestEdge = Math.max(srcW, srcH);
  const needsResize = longestEdge > MAX_EDGE || file.size > MAX_BYTES;

  if (!needsResize) {
    if ('close' in bitmap) bitmap.close();
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      dimensions: { width: srcW, height: srcH },
      downscaled: false,
      originalBytes: file.size,
    };
  }

  const scale = Math.min(1, MAX_EDGE / longestEdge);
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageRejected('Peramban tidak mendukung pemrosesan kanvas.');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);
  if ('close' in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    // PNG, because the engine re-encodes to PNG anyway and JPEG artefacts
    // would only make OCR and QR decoding harder.
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new ImageRejected('Gagal mengecilkan gambar.');

  if (blob.size > MAX_BYTES) {
    throw new ImageRejected(
      `Ukuran berkas masih ${(blob.size / 1024 / 1024).toFixed(1)} MB setelah dikecilkan. Batas ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const resized = new File([blob], file.name.replace(/\.\w+$/, '') + '.png', {
    type: 'image/png',
  });

  return {
    file: resized,
    previewUrl: URL.createObjectURL(resized),
    // The DOWNSCALED dimensions: this is what the engine will see.
    dimensions: { width: outW, height: outH },
    downscaled: true,
    originalBytes: file.size,
  };
}

/**
 * First usable image on a clipboard event. Judges paste screenshots, and
 * supporting it costs almost nothing.
 */
export function imageFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** First image in a drop, ignoring any non-image companions. */
export function imageFromDrop(event: DragEvent): File | null {
  const files = event.dataTransfer?.files;
  if (!files) return null;
  for (const file of files) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}
