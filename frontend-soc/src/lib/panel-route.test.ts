import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPanelHref,
  parsePanelView,
  parseResponseTab,
  readPanelQuery,
} from './panel-route';

describe('panel-route deep-linking', () => {
  it('defaults to beranda and a clean root href', () => {
    assert.equal(parsePanelView(null), 'beranda');
    assert.equal(parsePanelView('unknown-panel'), 'beranda');
    assert.equal(buildPanelHref('beranda'), '/');
  });

  it('builds and parses forensik deep links with insiden id', () => {
    const href = buildPanelHref('forensik', { insiden: '6dec7ab9-54de-49b9-bc93-f4f9b405ba16' });
    assert.equal(href, '/?view=forensik&insiden=6dec7ab9-54de-49b9-bc93-f4f9b405ba16');

    const parsed = readPanelQuery(new URLSearchParams(href.slice(2)));
    assert.equal(parsed.view, 'forensik');
    assert.equal(parsed.insiden, '6dec7ab9-54de-49b9-bc93-f4f9b405ba16');
  });

  it('builds and parses respons deep links with focused host', () => {
    const href = buildPanelHref('respons', { host: 'evil-login.example' });
    assert.equal(href, '/?view=respons&host=evil-login.example');

    const parsed = readPanelQuery(new URLSearchParams(href.slice(2)));
    assert.equal(parsed.view, 'respons');
    assert.equal(parsed.tab, 'blokir');
    assert.equal(parsed.host, 'evil-login.example');
  });

  it('carries the WhatsApp half of respons in the tab param', () => {
    const href = buildPanelHref('respons', { tab: 'wa' });
    assert.equal(href, '/?view=respons&tab=wa');
    assert.equal(readPanelQuery(new URLSearchParams(href.slice(2))).tab, 'wa');
  });

  it('resolves retired view ids onto the panels that absorbed them', () => {
    assert.equal(parsePanelView('sandbox'), 'beranda');
    assert.equal(parsePanelView('komando'), 'beranda');
    assert.equal(parsePanelView('forensics'), 'forensik');
    assert.equal(parsePanelView('whatsapp'), 'respons');
    assert.equal(parsePanelView('mitigasi'), 'respons');
    assert.equal(parsePanelView('audit'), 'evaluasi');
  });

  it('old mitigasi and lapor-cepat links land on the right half', () => {
    const legacyWa = readPanelQuery(new URLSearchParams('view=lapor-cepat'));
    assert.equal(legacyWa.view, 'respons');
    assert.equal(legacyWa.tab, 'wa');

    const legacyBlock = readPanelQuery(new URLSearchParams('view=mitigasi&host=evil.example'));
    assert.equal(legacyBlock.view, 'respons');
    assert.equal(legacyBlock.tab, 'blokir');
    assert.equal(legacyBlock.host, 'evil.example');
  });

  it('falls back to the blocklist half for an unknown tab', () => {
    assert.equal(parseResponseTab('nonsense'), 'blokir');
    assert.equal(parseResponseTab(null), 'blokir');
  });
});
