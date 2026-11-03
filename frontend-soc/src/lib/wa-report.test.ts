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
  SEP,
  formatImageReport,
  formatUrlReport,
  isPublicEvidenceUrl,
  ticketLine,
  verdictBlock,
} from './wa-report';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '..', 'fixtures', `${name}.json`), 'utf8'));

describe('separator', () => {
  it('matches wa_triage.py line 175 exactly', () => {
    assert.equal(SEP, '━━━━━━━━━━━━━━━━━━━━━━');
    assert.equal(SEP.length, 22);
  });
});

describe('ticketLine', () => {
  it('matches the bot format', () => {
    assert.equal(
      ticketLine('6dec7ab9-54de-49b9-bc93-f4f9b405ba16'),
      '🆔 *ID Tiket SOC*: `#VK-6DEC7AB9`',
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
  it('returns the header, status label and advice triple', () => {
    const block = verdictBlock('CRITICAL_PHISHING', 'URL');
    assert.equal(block.length, 3);
    assert.match(block[0], /^🚨 \*PERINGATAN KRITIS/);
    assert.equal(block[1], 'BERBAHAYA (CRITICAL PHISHING)');
    assert.match(block[2], /^⛔ \*INSTRUKSI TAKTIS\*/);
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
    assert.match(block[1], /QUISHING/);
    assert.match(block[2], /QR Code/);
  });

  it('treats an official military poster as safe military content', () => {
    const block = verdictBlock('SAFE', 'IMAGE', 'POSTER_OFFICIAL_MILITARY');
    assert.match(block[1], /KONTEN MILITER/);
  });

  it('separates a safe official portal from a safe general site', () => {
    assert.match(verdictBlock('SAFE', 'URL', 'OFFICIAL_MILITARY')[1], /PORTAL RESMI/);
    assert.match(verdictBlock('SAFE', 'URL', 'GENERAL_WEB_SAFE')[1], /SITUS UMUM NON-TNI/);
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

  it('opens with the header and the bot subtitle', () => {
    const lines = report.split('\n');
    assert.match(lines[0], /^🚨 \*PERINGATAN KRITIS/);
    assert.equal(lines[1], '_VisiKartika Shield — Hasil Analisis Forensik URL_');
    assert.equal(lines[2], SEP);
  });

  it('renders the score tree with the bot box-drawing characters', () => {
    assert.match(report, /📈 \*Skor Risiko Total\*: \*\d+\.\d \/ 100\*/);
    assert.match(report, /^ {3}├─ Kemiripan Visual: `\d+\.\d%`$/m);
    assert.match(report, /^ {3}├─ Anomali Struktur DOM: `\d+\.\d%`$/m);
    assert.match(report, /^ {3}└─ Telemetri Domain: `\d+\.\d%`$/m);
  });

  it('caps findings at three, as the bot does', () => {
    const findings = report.split('\n').filter((l) => l.startsWith('  • '));
    assert.ok(findings.length <= 3, `expected at most 3 findings, got ${findings.length}`);
  });

  it('caps detected logos at two', () => {
    const line = report.split('\n').find((l) => l.includes('Atribut Militer Terdeteksi'));
    if (line) assert.ok(line.split(',').length <= 2);
  });

  it('closes with the separator then the advice', () => {
    const lines = report.split('\n');
    const sepAt = lines.lastIndexOf(SEP);
    assert.ok(sepAt > 0);
    assert.match(lines.slice(sepAt + 1).join('\n'), /INSTRUKSI TAKTIS|INFORMASI/);
  });

  it('omits a localhost evidence link', () => {
    // The engine's fallback URL points at localhost, which a phone cannot open.
    assert.ok(!report.includes('Bukti Visual*: http://localhost'));
  });
});

describe('formatImageReport', () => {
  const scan = normalizeImageScan(fixture('scan-image-quishing'), 'test-2', {
    width: 1280,
    height: 720,
  });
  const report = formatImageReport(scan);

  it('uses the image subtitle and content-type line', () => {
    assert.match(report, /_VisiKartika Shield — Forensik Poster, Screenshot & QR_/);
    assert.match(report, /🗂️ \*Jenis Konten\*: `\w+`/);
  });

  it('labels the DOM row as content/OCR/QR rather than DOM structure', () => {
    assert.match(report, /├─ Anomali Konten\/OCR\/QR:/);
    assert.ok(!report.includes('Anomali Struktur DOM'));
  });

  it('shows the decoded QR payload', () => {
    assert.match(report, /📷 \*Isi QR Code\*: `https?:\/\//);
  });

  it('prefers the QR payload over OCR links when both exist', () => {
    // wa_triage.py uses elif: QR wins.
    assert.ok(report.includes('Isi QR Code'));
    assert.ok(!report.includes('Tautan Terbaca (OCR)'));
  });
});

describe('safe verdicts', () => {
  const scan = normalizeUrlScan(fixture('scan-url-safe'), 'test-3');
  const report = formatUrlReport(scan);

  it('reports an official portal as verified safe', () => {
    assert.match(report, /✅ \*AMAN/);
    assert.match(report, /PORTAL RESMI/);
  });

  it('suppresses the impersonation line on a safe verdict', () => {
    // wa_triage.py only prints it when verdict != SAFE.
    assert.ok(!report.includes('Indikasi Penyamaran'));
  });
});
