/**
 * The markup tokeniser, tested through the same regex the component uses.
 *
 * The case that matters most is a reported URL containing underscores: those
 * must survive verbatim, because the operator is reading them as an indicator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Kept identical to the TOKEN pattern in WaMarkup.tsx. */
const TOKEN = /(^|[^\w\\])([*_~`])(?=\S)([\s\S]*?\S)\2(?![\w])/;

/** Plain-text reduction of the component's parse loop, for assertion purposes. */
function flatten(text: string): { plain: string; spans: { marker: string; inner: string }[] } {
  let rest = text;
  let plain = '';
  const spans: { marker: string; inner: string }[] = [];

  while (rest.length > 0) {
    const m = TOKEN.exec(rest);
    if (!m || m.index === undefined) {
      plain += rest;
      break;
    }
    plain += rest.slice(0, m.index) + m[1];
    spans.push({ marker: m[2], inner: m[3] });
    plain += m[3];
    rest = rest.slice(m.index + m[0].length);
  }
  return { plain, spans };
}

describe('WhatsApp markup', () => {
  it('formats a marker at a word boundary', () => {
    const r = flatten('Status: *BERBAHAYA* sekarang');
    assert.deepEqual(r.spans, [{ marker: '*', inner: 'BERBAHAYA' }]);
    assert.equal(r.plain, 'Status: BERBAHAYA sekarang');
  });

  it('leaves underscores inside a URL alone', () => {
    // The regression this test exists for: these underscores were being eaten,
    // rewriting the indicator shown to the operator.
    const url = 'http://localhost:8000/mock-targets/rekrutmen_bintara_phish.html';
    const r = flatten(url);
    assert.equal(r.spans.length, 0);
    assert.equal(r.plain, url);
  });

  it('leaves underscores inside an identifier alone', () => {
    const r = flatten('field nrp_nik and kata_sandi_dinas');
    assert.equal(r.spans.length, 0);
    assert.equal(r.plain, 'field nrp_nik and kata_sandi_dinas');
  });

  it('still italicises a properly delimited phrase', () => {
    const r = flatten('_VisiKartika Shield — Forensik_');
    assert.deepEqual(r.spans, [{ marker: '_', inner: 'VisiKartika Shield — Forensik' }]);
  });

  it('handles monospace spans', () => {
    const r = flatten('Skor: `99.5%` total');
    assert.deepEqual(r.spans, [{ marker: '`', inner: '99.5%' }]);
    assert.equal(r.plain, 'Skor: 99.5% total');
  });

  it('does not format an unpaired marker', () => {
    const r = flatten('2 * 3 = 6');
    assert.equal(r.spans.length, 0);
    assert.equal(r.plain, '2 * 3 = 6');
  });

  it('handles several markers on one line', () => {
    const r = flatten('*Status*: _aman_ dan `0.0`');
    assert.deepEqual(r.spans.map((s) => s.marker), ['*', '_', '`']);
  });

  it('preserves every character of the original text', () => {
    // Any formatting pass that loses characters is wrong by definition.
    for (const sample of [
      '🔗 *Tautan Target*: http://a.test/x_y_z.html',
      '   ├─ Kemiripan Visual: `99.0%`',
      '• *JANGAN* masukkan NRP, NIK, kata sandi, PIN, atau kode OTP!',
      'Cross-origin endpoint: https://evil-exfil-collector.example.com/harvest.php',
    ]) {
      const stripped = sample.replace(/(^|[^\w\\])([*_~`])(?=\S)([\s\S]*?\S)\2(?![\w])/g, '$1$3');
      assert.equal(flatten(sample).plain, stripped, `lost characters in: ${sample}`);
    }
  });
});
