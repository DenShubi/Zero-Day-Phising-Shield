/**
 * Verdict vocabulary, shared by every surface (badges, bars, charts, map, bbox strokes).
 *
 * Mirrors app/scoring.py:
 *   VERDICT_SAFE / VERDICT_SUSPICIOUS / VERDICT_CRITICAL
 *   THRESHOLD_CRITICAL = 70.0, THRESHOLD_SUSPICIOUS = 40.0
 *   weights: visual 0.45, dom 0.30, domain 0.25
 *
 * Thresholds are for CHART BANDS ONLY. Never recompute a verdict from a score:
 * deterministic override floors/caps in app/scoring.py can move the verdict off
 * the weighted score, and a client-side recompute would disagree with the engine.
 */

export type Verdict = 'SAFE' | 'SUSPICIOUS' | 'CRITICAL_PHISHING';

export const THRESHOLD_SUSPICIOUS = 40;
export const THRESHOLD_CRITICAL = 70;

export const RISK_WEIGHTS = { visual: 0.45, dom: 0.3, domain: 0.25 } as const;

/** Indonesian labels shown to the operator. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  SAFE: 'AMAN',
  SUSPICIOUS: 'MENCURIGAKAN',
  CRITICAL_PHISHING: 'PHISHING KRITIS',
};

/**
 * Never encode a verdict by colour alone: these pair with an icon and a text
 * label everywhere, for projector legibility and for colour-blind viewers.
 */
export const VERDICT_ICON: Record<Verdict, string> = {
  SAFE: 'shield-check',
  SUSPICIOUS: 'alert-triangle',
  CRITICAL_PHISHING: 'octagon-alert',
};

/** CSS custom-property names defined once in globals.css. */
export const VERDICT_VAR: Record<Verdict, string> = {
  SAFE: '--verdict-safe',
  SUSPICIOUS: '--verdict-suspicious',
  CRITICAL_PHISHING: '--verdict-critical',
};

export const VERDICT_ORDER: readonly Verdict[] = [
  'CRITICAL_PHISHING',
  'SUSPICIOUS',
  'SAFE',
] as const;

/**
 * Annotation layer colours, mirroring what the backend burns into
 * annotated_bbox_url so the live overlay and the stored evidence agree:
 *   crimson  app/vision/logo_detector.py  - impersonated logo
 *   magenta  app/vision/ocr_quishing.py   - QR quishing code
 *   amber    app/sandbox/annotator.py     - cross-origin form exfiltration
 *            app/vision/image_analyzer.py - visual login input box (OCR path)
 *   red      app/sandbox/annotator.py     - sensitive credential input
 */
export type OverlayLayer = 'logo' | 'qr' | 'form' | 'input';

export const LAYER_LABEL: Record<OverlayLayer, string> = {
  logo: 'Logo dicatut',
  qr: 'QR quishing',
  form: 'Form eksfiltrasi',
  input: 'Input kredensial',
};

export const LAYER_VAR: Record<OverlayLayer, string> = {
  logo: '--layer-logo',
  qr: '--layer-qr',
  form: '--layer-form',
  input: '--layer-input',
};

/** Band a score falls into, for chart shading only. */
export function bandOf(totalRisk: number): Verdict {
  if (totalRisk >= THRESHOLD_CRITICAL) return 'CRITICAL_PHISHING';
  if (totalRisk >= THRESHOLD_SUSPICIOUS) return 'SUSPICIOUS';
  return 'SAFE';
}
