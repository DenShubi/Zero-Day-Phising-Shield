import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPanelHref, parsePanelView, readPanelQuery } from './panel-route';

describe('panel-route deep-linking', () => {
  it('defaults to komando and clean root href', () => {
    assert.equal(parsePanelView(null), 'komando');
    assert.equal(parsePanelView('unknown-panel'), 'komando');
    assert.equal(buildPanelHref('komando'), '/');
  });

  it('builds and parses forensik deep links with insiden id', () => {
    const href = buildPanelHref('forensik', { insiden: '6dec7ab9-54de-49b9-bc93-f4f9b405ba16' });
    assert.equal(href, '/?view=forensik&insiden=6dec7ab9-54de-49b9-bc93-f4f9b405ba16');

    const parsed = readPanelQuery(new URLSearchParams(href.slice(2)));
    assert.equal(parsed.view, 'forensik');
    assert.equal(parsed.insiden, '6dec7ab9-54de-49b9-bc93-f4f9b405ba16');
  });

  it('builds and parses mitigasi deep links with focused host', () => {
    const href = buildPanelHref('mitigasi', { host: 'evil-login.example' });
    assert.equal(href, '/?view=mitigasi&host=evil-login.example');

    const parsed = readPanelQuery(new URLSearchParams(href.slice(2)));
    assert.equal(parsed.view, 'mitigasi');
    assert.equal(parsed.host, 'evil-login.example');
  });

  it('resolves legacy aliases cleanly', () => {
    assert.equal(parsePanelView('sandbox'), 'pemindaian');
    assert.equal(parsePanelView('forensics'), 'forensik');
    assert.equal(parsePanelView('whatsapp'), 'lapor-cepat');
  });
});
