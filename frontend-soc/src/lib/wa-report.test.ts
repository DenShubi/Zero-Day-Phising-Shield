/**
 * Guards the port of the bot's reply formatter against app/wa_triage.py.
 *
 * The risk being covered is drift: if the port and the bot disagree, the
 * simulation shows a judge something the real bot would not send.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeImageScan, normalizeUrlScan } from './normalize';
import {
  LAYOUT_LABELS,
  formatImageReport,
  formatUrlReport,
  isPublicEvidenceUrl,
  ticketLine,
  verdictBlock,
} from './wa-report';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '..', 'fixtures', `${name}.json`), 'utf8'));

describe('layoutLabels', () => {
  it('maps layout enum values to Indonesian labels matching wa_triage.py', () => {
    assert.equal(LAYOUT_LABELS.POSTER_OR_BANNER, 'Poster / Selebaran');
    assert.equal(LAYOUT_LABELS.MOBILE_SCREENSHOT, 'Tangkapan Layar HP');
    assert.equal(LAYOUT_LABELS.WEB_SCREENSHOT, 'Tangkapan Layar Web');
    assert.equal(LAYOUT_LABELS.GENERAL_IMAGE, 'Gambar Umum');
  });
});

describe('ticketLine', () => {
  it('matches the Option 2 bot format (#JB-)', () => {
    assert.equal(
      ticketLine('6dec7ab9-54de-49b9-bc93-f4f9b405ba16'),
      'Tiket SOC  : `#JB-6DEC7AB9`',
    );
  });

  it('omits the line when there is no incident', () => {
    assert.equal(ticketLine(null), null);
  });
});

describe('isPublicEvidenceUrl', () => {
  it('rejects a localhost link, which is useless inside WhatsApp', () => {
    assert.equal(isPublicEvidenceUrl('http://localhost:8000/static/a.png'), false);
    assert.equal(isPublicEvidenceUrl('http://127.0.0.1:8000/static/a.png'), false);
  });

  it('accepts a public storage link', () => {
    assert.equal(isPublicEvidenceUrl('https://x.supabase.co/storage/v1/object/public/a.png'), true);
  });

  it('rejects a missing link', () => {
    assert.equal(isPublicEvidenceUrl(null), false);
  });
});

describe('verdictBlock', () => {
  it('returns the header, status label and advice triple without decorative emojis', () => {
    const block = verdictBlock('CRITICAL_PHISHING', 'URL');
    assert.equal(block.length, 3);
    assert.equal(block[0], '*Putusan: BERBAHAYA (Phishing Terdeteksi)*');
    assert.equal(block[1], 'BERBAHAYA');
    assert.match(block[2], /^Saran:\n/);
  });

  it('distinguishes generic phishing from military impersonation', () => {
    const generic = verdictBlock('CRITICAL_PHISHING', 'URL', 'GENERIC_PHISHING');
    const military = verdictBlock('CRITICAL_PHISHING', 'URL', 'MILITARY_PHISHING');
    assert.notEqual(generic[0], military[0]);
    // Only the military copy warns about NRP and unit groups.
    assert.match(military[2], /NRP/);
    assert.ok(!/NRP/.test(generic[2]));
  });

  it('warns about QR codes and APKs on an image verdict', () => {
    const block = verdictBlock('CRITICAL_PHISHING', 'IMAGE', 'POSTER_SCAM');
    assert.match(block[0], /Poster \/ QR Palsu/);
    assert.match(block[2], /kode QR/);
  });

  it('treats an official military poster as safe military content', () => {
    const block = verdictBlock('SAFE', 'IMAGE', 'POSTER_OFFICIAL_MILITARY');
    assert.match(block[1], /Publikasi Resmi/);
  });

  it('separates a safe official portal from a safe general site', () => {
    assert.match(verdictBlock('SAFE', 'URL', 'OFFICIAL_MILITARY')[1], /Portal Resmi/);
    assert.match(verdictBlock('SAFE', 'URL', 'GENERAL_WEB_SAFE')[1], /Situs Umum Non-Kedinasan/);
  });

  it('covers every verdict and kind without throwing', () => {
    for (const v of ['SAFE', 'SUSPICIOUS', 'CRITICAL_PHISHING'] as const) {
      for (const k of ['URL', 'IMAGE'] as const) {
        for (const c of ['UNKNOWN', 'GENERIC_PHISHING', 'OFFICIAL_MILITARY', 'POSTER_SCAM']) {
          const block = verdictBlock(v, k, c);
          assert.equal(block.length, 3);
          assert.ok(block.every((s) => s.length > 0));
        }
      }
    }
  });
});

describe('formatUrlReport', () => {
  const scan = normalizeUrlScan(fixture('scan-url-critical'), 'test-1');
  const report = formatUrlReport(scan);

  it('opens with the structured verdict header and ticket line', () => {
    const lines = report.split('\n');
    assert.equal(lines[0], '*Putusan: BERBAHAYA (Phishing Terdeteksi)*');
    assert.match(lines[1], /^Tiket SOC  : `#JB-[0-9A-F]+`$/);
  });

  it('renders the clean score breakdown without ASCII box borders', () => {
    assert.match(report, /^Skor Risiko: \d+\.\d \/ 100$/m);
    assert.match(report, /^- Kemiripan tampilan : \d+\.\d%$/m);
    assert.match(report, /^- Perilaku halaman   : \d+\.\d%$/m);
    assert.match(report, /^- Reputasi domain    : \d+\.\d%$/m);
    assert.ok(!report.includes('━━'));
    assert.ok(!report.includes('├─'));
  });

  it('caps findings at three, as the bot does', () => {
    const alasanIdx = report.indexOf('\nAlasan:\n');
    assert.ok(alasanIdx > 0);
    const afterAlasan = report.slice(alasanIdx + '\nAlasan:\n'.length);
    const findings: string[] = [];
    for (const l of afterAlasan.split('\n')) {
      if (l.startsWith('- ')) findings.push(l);
      else break;
    }
    assert.ok(findings.length <= 3, `expected at most 3 findings, got ${findings.length}`);
  });

  it('caps detected logos at two', () => {
    const line = report.split('\n').find((l) => l.startsWith('Atribut    :'));
    if (line) assert.ok(line.split(',').length <= 2);
  });

  it('closes with Saran or Catatan block', () => {
    assert.match(report, /\n(Saran|Catatan):\n/);
  });

  it('omits a localhost evidence link', () => {
    assert.ok(!report.includes('Bukti visual: http://localhost'));
  });
});

describe('formatImageReport', () => {
  const scan = normalizeImageScan(fixture('scan-image-quishing'), 'test-2', {
    width: 1280,
    height: 720,
  });
  const report = formatImageReport(scan);

  it('uses the human-readable Jenis label', () => {
    assert.match(report, /^Jenis      : Tangkapan Layar Web$/m);
  });

  it('labels the content row as Konten & kode QR rather than Perilaku halaman', () => {
    assert.match(report, /^- Konten & kode QR   : \d+\.\d%$/m);
    assert.ok(!report.includes('Perilaku halaman'));
  });

  it('shows the decoded QR payload', () => {
    assert.match(report, /^Isi QR     : `https?:\/\//m);
  });

  it('prefers the QR payload over OCR links when both exist', () => {
    assert.ok(report.includes('Isi QR     :'));
    assert.ok(!report.includes('Tautan OCR :'));
  });
});

describe('safe verdicts', () => {
  const scan = normalizeUrlScan(fixture('scan-url-safe'), 'test-3');
  const report = formatUrlReport(scan);

  it('reports an official portal as verified safe', () => {
    assert.match(report, /^\*Putusan: AMAN \(Portal Resmi\)\*/);
    assert.match(report, /^Status     : AMAN \(Portal Resmi \.mil\.id\)$/m);
  });

  it('suppresses the impersonation line on a safe verdict', () => {
    assert.ok(!report.includes('Meniru     :'));
  });
});
