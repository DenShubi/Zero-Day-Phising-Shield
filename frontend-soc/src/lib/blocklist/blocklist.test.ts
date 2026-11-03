/**
 * Guards the host validator and the export syntax.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractIocs, validateHost, type Ioc } from './extract';
import {
  renderCsv,
  renderDnsmasq,
  renderHosts,
  renderPiholeRegex,
  renderRpz,
  renderSquid,
  renderStix,
  renderSuricata,
} from './formats';
import type { NormalizedScan } from '../normalize';

const ioc = (host: string, over: Partial<Ioc> = {}): Ioc => ({
  host,
  provenance: 'URL_FINAL',
  verdict: 'CRITICAL_PHISHING',
  riskScore: 92.5,
  incidentId: '6dec7ab9-54de-49b9-bc93-f4f9b405ba16',
  ticket: '#VK-6DEC7AB9',
  firstSeenIso: '2026-11-03T04:07:01.301Z',
  impersonatedTarget: 'Kementerian Pertahanan RI',
  ...over,
});

describe('validateHost', () => {
  it('normalises a full URL down to its host', () => {
    const r = validateHost('HTTPS://User@Evil.Example.COM:8443/login?a=1#x');
    assert.deepEqual(r, { host: 'evil.example.com' });
  });

  it('strips a trailing root dot', () => {
    assert.deepEqual(validateHost('evil.example.com.'), { host: 'evil.example.com' });
  });

  it('keeps punycode A-labels, which RPZ and dnsmasq require', () => {
    assert.deepEqual(validateHost('xn--80ak6aa92e.com'), { host: 'xn--80ak6aa92e.com' });
  });

  it('rejects the OCR comma-for-dot misread', () => {
    // The exact failure mode this validator exists to catch.
    assert.ok('reason' in validateHost('tniad,mil.id'));
  });

  it('rejects other OCR noise', () => {
    for (const bad of ['tniad .mil.id', 'tni_ad.mil.id', 'tniad..mil.id', '-tniad.mil.id']) {
      assert.ok('reason' in validateHost(bad), `${bad} should be rejected`);
    }
  });

  it('rejects single-label and local names', () => {
    for (const bad of ['localhost', 'intranet', 'printer.local', 'db.internal']) {
      assert.ok('reason' in validateHost(bad), `${bad} should be rejected`);
    }
  });

  it('rejects private, loopback and link-local IPs', () => {
    for (const bad of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.1.1']) {
      assert.ok('reason' in validateHost(bad), `${bad} should be rejected`);
    }
  });

  it('accepts a routable public IP', () => {
    assert.deepEqual(validateHost('203.0.113.42'), { host: '203.0.113.42' });
  });

  it('rejects over-long names and labels', () => {
    assert.ok('reason' in validateHost(`${'a'.repeat(64)}.com`));
    assert.ok('reason' in validateHost(`${'a'.repeat(250)}.example.com`));
  });

  it('rejects a numeric TLD', () => {
    assert.ok('reason' in validateHost('1.2.3.4.5'));
  });
});

describe('extractIocs', () => {
  const base: NormalizedScan = {
    kind: 'IMAGE',
    scanId: 's1',
    incidentId: 'i1',
    ticket: '#VK-I1',
    submittedUrl: '[IMAGE:POSTER_FLYER] poster.png',
    finalUrl: null,
    host: null,
    verdict: 'CRITICAL_PHISHING',
    scores: { visual: 90, dom: 90, domain: 90, total: 93, weightedBase: 90, ruleDelta: 3, baseFromEngine: true },
    contentCategory: 'POSTER_SCAM',
    impersonatedTarget: null,
    screenshotUrl: null,
    annotatedUrl: null,
    sourceSpace: null,
    detectedLogos: [],
    forensicReasons: [],
    appliedRules: [],
    latencyMs: {},
    executionSec: null,
    synced: true,
    degraded: false,
    reporterSource: null,
    reporterUnit: null,
    createdAtIso: '2026-11-03T04:07:01.301Z',
    createdAtMs: Date.parse('2026-11-03T04:07:01.301Z'),
    image: {
      layoutType: 'POSTER_FLYER',
      qrCodes: [{ payload: 'https://rekrutmen-bintara-tniad.com/verifikasi', bbox: null, decoder: 'opencv' }],
      extractedUrls: ['https://rekrutmen-bintara-tniad.com/verifikasi', 'tniad,mil.id'],
      ocrTextSnippet: null,
      visualInputBoxesCount: 0,
      sourceImage: null,
    },
  };

  it('recovers the QR host when the poster has no URL of its own', () => {
    // The only real indicator a quishing poster carries.
    const { iocs } = extractIocs([base]);
    assert.ok(iocs.some((i) => i.host === 'rekrutmen-bintara-tniad.com'));
  });

  it('does not treat the synthetic image label as a host', () => {
    const { iocs } = extractIocs([base]);
    assert.ok(!iocs.some((i) => i.host.includes('image')));
  });

  it('records why a candidate was rejected', () => {
    const { rejected } = extractIocs([base]);
    assert.ok(rejected.some((r) => r.raw === 'tniad,mil.id'));
  });

  it('prefers the stronger provenance when a host appears twice', () => {
    // Present as both a QR payload and OCR text; QR is the trustworthy one.
    const { iocs } = extractIocs([base]);
    const found = iocs.find((i) => i.host === 'rekrutmen-bintara-tniad.com');
    assert.equal(found?.provenance, 'QR_PAYLOAD');
  });
});

describe('RPZ', () => {
  const out = renderRpz([ioc('evil.example.com'), ioc('203.0.113.42')]);

  it('comments with semicolons, never #', () => {
    // A `#` header makes BIND refuse to load the zone.
    const commentLines = out.split('\n').filter((l) => l.trimStart().startsWith('#'));
    assert.equal(commentLines.length, 0);
    assert.ok(out.includes('; '));
  });

  it('carries the directives a zone needs to load', () => {
    assert.match(out, /^\$TTL \d+/m);
    assert.match(out, /^\$ORIGIN \S+\.$/m);
    assert.match(out, /IN\s+SOA\s/);
    assert.match(out, /IN\s+NS\s/);
  });

  it('uses owner names relative to $ORIGIN', () => {
    // A trailing dot would make every rule silently stop matching.
    assert.match(out, /^evil\.example\.com {2}CNAME {2}\.$/m);
    assert.ok(!out.includes('evil.example.com.  CNAME'));
  });

  it('emits both apex and wildcard, since the wildcard misses the apex', () => {
    assert.match(out, /^evil\.example\.com {2}CNAME/m);
    assert.match(out, /^\*\.evil\.example\.com {2}CNAME/m);
  });

  it('starts every record at column 0', () => {
    const records = out.split('\n').filter((l) => /CNAME/.test(l) && !l.trimStart().startsWith(';'));
    assert.ok(records.length > 0);
    for (const r of records) assert.ok(!/^\s/.test(r), `indented record: ${r}`);
  });

  it('uses an rpz-ip trigger for an IP, with reversed octets', () => {
    assert.match(out, /^32\.42\.113\.0\.203\.rpz-ip {2}CNAME {2}\.$/m);
  });

  it('does not emit an IP as a QNAME rule', () => {
    assert.ok(!/^203\.0\.113\.42 {2}CNAME/m.test(out));
  });
});

describe('dnsmasq', () => {
  const out = renderDnsmasq([ioc('evil.example.com')]);

  it('emits both A and AAAA sinkholes', () => {
    // Without the AAAA line, IPv6 clients reach the host anyway.
    assert.match(out, /^address=\/evil\.example\.com\/0\.0\.0\.0$/m);
    assert.match(out, /^address=\/evil\.example\.com\/::$/m);
  });

  it('emits no wildcard, which would be a syntax error here', () => {
    assert.ok(!out.includes('address=/*.'));
  });
});

describe('hosts', () => {
  const out = renderHosts([ioc('evil.example.com')]);

  it('sinkholes to 0.0.0.0 and expands www', () => {
    assert.match(out, /^0\.0\.0\.0 evil\.example\.com$/m);
    assert.match(out, /^0\.0\.0\.0 www\.evil\.example\.com$/m);
  });

  it('says plainly that it cannot wildcard', () => {
    assert.match(out, /TIDAK mendukung wildcard/);
  });
});

describe('Pi-hole regex', () => {
  it('anchors so the apex and subdomains both match', () => {
    const out = renderPiholeRegex([ioc('evil.example.com')]);
    const line = out.split('\n').find((l) => l.includes('evil'));
    assert.ok(line);
    const re = new RegExp(line);
    assert.ok(re.test('evil.example.com'));
    assert.ok(re.test('login.evil.example.com'));
    assert.ok(!re.test('notevil.example.com'));
    assert.ok(!re.test('evil.example.com.attacker.net'));
  });
});

describe('Squid', () => {
  it('prefixes a dot for subdomain coverage but not for an IP', () => {
    const out = renderSquid([ioc('evil.example.com'), ioc('203.0.113.42')]);
    assert.match(out, /^\.evil\.example\.com$/m);
    assert.match(out, /^203\.0\.113\.42$/m);
  });
});

describe('Suricata', () => {
  const out = renderSuricata([ioc('evil.example.com'), ioc('bad.example.net')]);

  it('emits http.host and tls.sni rules', () => {
    assert.match(out, /http\.host; content:"evil\.example\.com"/);
    assert.match(out, /tls\.sni; content:"evil\.example\.com"/);
  });

  it('gives every rule a unique sid', () => {
    const sids = [...out.matchAll(/sid:(\d+);/g)].map((m) => m[1]);
    assert.ok(sids.length >= 4);
    assert.equal(new Set(sids).size, sids.length);
  });

  it('closes every rule', () => {
    for (const line of out.split('\n').filter((l) => l.startsWith('alert '))) {
      assert.ok(line.trimEnd().endsWith(')'), `unterminated rule: ${line}`);
      assert.match(line, /rev:\d+;\)$/);
    }
  });
});

describe('STIX', () => {
  const bundle = JSON.parse(renderStix([ioc('evil.example.com'), ioc('203.0.113.42')]));

  it('is a 2.1 bundle', () => {
    assert.equal(bundle.type, 'bundle');
    assert.match(bundle.id, /^bundle--[0-9a-f-]{36}$/);
  });

  it('writes a domain-name pattern for a domain', () => {
    const i = bundle.objects.find((o: { name?: string }) => o.name?.includes('evil.example.com'));
    assert.equal(i.pattern, "[domain-name:value = 'evil.example.com']");
    assert.equal(i.spec_version, '2.1');
    assert.equal(i.pattern_type, 'stix');
  });

  it('writes an ipv4-addr pattern for an IP', () => {
    const i = bundle.objects.find((o: { name?: string }) => o.name?.includes('203.0.113.42'));
    assert.equal(i.pattern, "[ipv4-addr:value = '203.0.113.42']");
  });
});

describe('CSV', () => {
  const out = renderCsv([ioc('evil.example.com')]);

  it('uses semicolons and CRLF with a BOM, for Excel in id-ID', () => {
    assert.ok(out.startsWith('﻿'));
    assert.ok(out.includes('\r\n'));
    assert.ok(out.split('\r\n')[0].includes(';'));
  });

  it('quotes every field', () => {
    assert.match(out, /"evil\.example\.com"/);
  });

  it('escapes embedded quotes rather than breaking the row', () => {
    const tricky = renderCsv([ioc('evil.example.com', { impersonatedTarget: 'He said "hi"' })]);
    assert.ok(tricky.includes('"He said ""hi"""'));
  });
});

describe('synthetic image labels', () => {
  it('reports a synthetic label as such, not as an IPv6 address', () => {
    // "[IMAGE] uploaded_image.png" starts with a bracket like an IPv6 literal,
    // but calling it one would mislead the operator reading the reject list.
    const r = validateHost('[IMAGE] uploaded_image.png');
    assert.ok('reason' in r);
    assert.match(r.reason, /sintetis/);
  });

  it('still rejects a real IPv6 literal as unsupported', () => {
    const r = validateHost('[2001:db8::1]');
    assert.ok('reason' in r);
    assert.match(r.reason, /IPv6/);
  });
});
