/**
 * Export renderers for DNS sinkhole, proxy and IDS blocklists.
 *
 * Each format has a quirk that silently breaks it if ignored, so they are noted
 * where they apply rather than left to be rediscovered:
 *
 *   RPZ      comments use `;` (a `#` header makes BIND refuse the zone), the
 *            zone needs $TTL/$ORIGIN/SOA/NS to load at all, owner names are
 *            RELATIVE to $ORIGIN (a trailing dot silently stops matching), the
 *            wildcard does not cover the apex so both lines are required, and
 *            records must start at column 0.
 *   dnsmasq  the /domain/ form already covers subdomains, so no wildcard line;
 *            but A-only entries leave AAAA queries resolving normally.
 *   hosts    no wildcard support at all, so subdomains must be enumerated.
 *   Pi-hole  a plain adlist matches exact names only; the regex list is what
 *            actually covers subdomains.
 *   CSV      Excel in an id-ID locale splits on `;`, not `,`.
 */

import type { Ioc } from './extract';
import { PROVENANCE_LABEL, isIpv4 } from './extract';

export type FormatId =
  | 'rpz'
  | 'dnsmasq'
  | 'hosts'
  | 'pihole'
  | 'pihole-regex'
  | 'squid'
  | 'suricata'
  | 'stix'
  | 'csv';

export interface FormatSpec {
  id: FormatId;
  label: string;
  description: string;
  filename: string;
  mime: string;
}

export const FORMATS: readonly FormatSpec[] = [
  {
    id: 'rpz',
    label: 'BIND RPZ',
    description: 'Zona Response Policy untuk resolver BIND — NXDOMAIN per indikator.',
    filename: 'db.rpz.visikartika',
    mime: 'text/plain',
  },
  {
    id: 'dnsmasq',
    label: 'dnsmasq',
    description: 'Sinkhole A dan AAAA; bentuk /domain/ sudah mencakup subdomain.',
    filename: 'visikartika-dnsmasq.conf',
    mime: 'text/plain',
  },
  {
    id: 'hosts',
    label: 'hosts',
    description: 'Berkas hosts klasik — tanpa wildcard, subdomain diperluas manual.',
    filename: 'visikartika-hosts.txt',
    mime: 'text/plain',
  },
  {
    id: 'pihole',
    label: 'Pi-hole (adlist)',
    description: 'Satu domain per baris untuk daftar blokir Pi-hole.',
    filename: 'visikartika-pihole.txt',
    mime: 'text/plain',
  },
  {
    id: 'pihole-regex',
    label: 'Pi-hole (regex)',
    description: 'Daftar regex Pi-hole — bentuk yang benar-benar mencakup subdomain.',
    filename: 'visikartika-pihole-regex.txt',
    mime: 'text/plain',
  },
  {
    id: 'squid',
    label: 'Squid ACL',
    description: 'Daftar dstdomain untuk proxy Squid.',
    filename: 'visikartika-squid-dstdomain.txt',
    mime: 'text/plain',
  },
  {
    id: 'suricata',
    label: 'Suricata',
    description: 'Aturan IDS berbasis http.host dan tls.sni.',
    filename: 'visikartika.rules',
    mime: 'text/plain',
  },
  {
    id: 'stix',
    label: 'STIX 2.1',
    description: 'Bundle indikator untuk pertukaran intelijen ancaman.',
    filename: 'visikartika-stix.json',
    mime: 'application/json',
  },
  {
    id: 'csv',
    label: 'CSV',
    description: 'Tabel indikator lengkap dengan skor, sumber, dan tiket SOC.',
    filename: 'visikartika-ioc.csv',
    mime: 'text/csv',
  },
] as const;

const PRODUCT = 'VisiKartika Shield';

function headerLines(iocs: readonly Ioc[], comment: string): string[] {
  const now = new Date().toISOString();
  return [
    `${comment} =====================================================================`,
    `${comment} ${PRODUCT} — daftar blokir indikator phishing`,
    `${comment} Dibuat   : ${now}`,
    `${comment} Indikator: ${iocs.length}`,
    `${comment} SIMULASI : indikator berasal dari lingkungan uji internal.`,
    `${comment}            Tinjau manual sebelum diterapkan pada resolver produksi.`,
    `${comment} =====================================================================`,
  ];
}

/* ---------------------------------- RPZ ---------------------------------- */

/** `203.0.113.42` -> `32.42.113.0.203` — prefix length first, octets reversed. */
function rpzIpTrigger(ip: string): string {
  return `32.${ip.split('.').reverse().join('.')}`;
}

export function renderRpz(iocs: readonly Ioc[], origin = 'rpz.visikartika.local'): string {
  const serial = Math.floor(Date.now() / 1000);
  const domains = iocs.filter((i) => !isIpv4(i.host));
  const ips = iocs.filter((i) => isIpv4(i.host));

  const lines = [
    ...headerLines(iocs, ';'),
    '; Catatan: nama pemilik bersifat RELATIF terhadap $ORIGIN (tanpa titik akhir).',
    ';',
    '; named.conf:',
    ';   options { response-policy { zone "' + origin + '"; } qname-wait-recurse no; };',
    ';   zone "' + origin + '" { type master; file "/etc/bind/db.rpz.visikartika";',
    ';                           allow-query { none; }; };',
    '',
    '$TTL 60',
    `$ORIGIN ${origin}.`,
    '',
    '@   IN  SOA  ns.' + origin + '. hostmaster.' + origin + '. (',
    `                ${serial} ; serial (epoch, selalu menaik)`,
    '                1h         ; refresh',
    '                15m        ; retry',
    '                7d         ; expire',
    '                60 )       ; minimum',
    '@   IN  NS   localhost.',
    '',
  ];

  if (domains.length > 0) {
    lines.push('; --- Indikator domain: NXDOMAIN pada apex dan seluruh subdomain ---');
    for (const ioc of domains) {
      // Both lines are required: the wildcard does not cover the apex.
      lines.push(`${ioc.host}  CNAME  .`);
      lines.push(`*.${ioc.host}  CNAME  .`);
    }
    lines.push('');
  }

  if (ips.length > 0) {
    lines.push('; --- Indikator alamat IP: wajib memakai trigger rpz-ip ---');
    for (const ioc of ips) {
      lines.push(`${rpzIpTrigger(ioc.host)}.rpz-ip  CNAME  .`);
    }
    lines.push('');
  }

  lines.push(
    '; Varian walled garden (ganti `CNAME .` di atas bila ingin halaman peringatan):',
    ';   <host>  CNAME  walled-garden.' + origin + '.',
  );

  return lines.join('\n') + '\n';
}

/* -------------------------------- dnsmasq -------------------------------- */

export function renderDnsmasq(iocs: readonly Ioc[]): string {
  const lines = [
    ...headerLines(iocs, '#'),
    '# Bentuk /domain/ sudah mencakup seluruh subdomain — tidak perlu wildcard.',
    '# Entri AAAA (::) wajib: tanpa itu kueri IPv6 tetap diteruskan ke upstream.',
    '',
  ];
  for (const ioc of iocs) {
    lines.push(`address=/${ioc.host}/0.0.0.0`);
    lines.push(`address=/${ioc.host}/::`);
  }
  lines.push('');
  lines.push('# Alternatif gaya NXDOMAIN (dnsmasq >= 2.86), mencakup kedua famili:');
  lines.push(`#   local=/${iocs[0]?.host ?? 'contoh.invalid'}/`);
  return lines.join('\n') + '\n';
}

/* --------------------------------- hosts --------------------------------- */

export function renderHosts(iocs: readonly Ioc[]): string {
  const lines = [
    ...headerLines(iocs, '#'),
    '# Berkas hosts TIDAK mendukung wildcard: hanya nama persis di bawah ini yang',
    '# diblokir. Apex dan www disertakan; subdomain lain perlu ditambahkan manual.',
    '',
  ];
  for (const ioc of iocs) {
    // 0.0.0.0 rather than 127.0.0.1: no local connection attempt is made.
    lines.push(`0.0.0.0 ${ioc.host}`);
    if (!isIpv4(ioc.host) && !ioc.host.startsWith('www.')) {
      lines.push(`0.0.0.0 www.${ioc.host}`);
    }
  }
  return lines.join('\n') + '\n';
}

/* -------------------------------- Pi-hole -------------------------------- */

export function renderPihole(iocs: readonly Ioc[]): string {
  return (
    [
      ...headerLines(iocs, '#'),
      '# Adlist mencocokkan nama persis. Gunakan ekspor regex untuk subdomain.',
      '',
      ...iocs.map((i) => i.host),
    ].join('\n') + '\n'
  );
}

export function renderPiholeRegex(iocs: readonly Ioc[]): string {
  const escape = (host: string) => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    [
      ...headerLines(iocs, '#'),
      '# Mencakup apex dan seluruh subdomain.',
      '',
      ...iocs.map((i) => `(^|\\.)${escape(i.host)}$`),
    ].join('\n') + '\n'
  );
}

/* --------------------------------- Squid --------------------------------- */

export function renderSquid(iocs: readonly Ioc[]): string {
  return (
    [
      ...headerLines(iocs, '#'),
      '# squid.conf:',
      '#   acl vk_block dstdomain "/etc/squid/visikartika-squid-dstdomain.txt"',
      '#   http_access deny vk_block',
      '#',
      '# Awalan titik mencakup domain beserta subdomainnya.',
      '',
      // A leading dot is Squid's subdomain form; an IP is matched literally.
      ...iocs.map((i) => (isIpv4(i.host) ? i.host : `.${i.host}`)),
    ].join('\n') + '\n'
  );
}

/* -------------------------------- Suricata -------------------------------- */

/** Local rules use the 1,000,000+ space; a contiguous block keeps them tidy. */
const SURICATA_SID_BASE = 9_100_000;

export function renderSuricata(iocs: readonly Ioc[]): string {
  const lines = [
    ...headerLines(iocs, '#'),
    '# Dua aturan per indikator: Host pada HTTP polos, dan SNI pada TLS.',
    `# Blok SID ${SURICATA_SID_BASE}+ dicadangkan untuk ${PRODUCT}.`,
    '',
  ];

  let sid = SURICATA_SID_BASE;
  for (const ioc of iocs) {
    if (isIpv4(ioc.host)) {
      lines.push(
        `alert ip any any -> ${ioc.host} any (msg:"${PRODUCT}: lalu lintas ke IP phishing ${ioc.host}"; ` +
          `classtype:policy-violation; sid:${sid++}; rev:1;)`,
      );
      continue;
    }
    lines.push(
      `alert http any any -> any any (msg:"${PRODUCT}: akses HTTP ke host phishing ${ioc.host}"; ` +
        `flow:established,to_server; http.host; content:"${ioc.host}"; nocase; ` +
        `classtype:policy-violation; sid:${sid++}; rev:1;)`,
    );
    lines.push(
      `alert tls any any -> any any (msg:"${PRODUCT}: SNI phishing ${ioc.host}"; ` +
        `tls.sni; content:"${ioc.host}"; nocase; ` +
        `classtype:policy-violation; sid:${sid++}; rev:1;)`,
    );
  }

  return lines.join('\n') + '\n';
}

/* --------------------------------- STIX ---------------------------------- */

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Not a secure context — fall through to the manual form below.
  }
  // RFC 4122 version 4 layout, built from Math.random as a last resort.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function renderStix(iocs: readonly Ioc[]): string {
  const now = new Date().toISOString();
  const objects: Record<string, unknown>[] = [
    {
      type: 'identity',
      spec_version: '2.1',
      id: `identity--${uuid()}`,
      created: now,
      modified: now,
      name: PRODUCT,
      identity_class: 'system',
      description:
        'Mesin penangkalan phishing VisiKartika Shield. Indikator berasal dari lingkungan simulasi internal.',
    },
  ];

  for (const ioc of iocs) {
    objects.push({
      type: 'indicator',
      spec_version: '2.1',
      id: `indicator--${uuid()}`,
      created: now,
      modified: now,
      name: `Domain phishing: ${ioc.host}`,
      description:
        `Terdeteksi oleh ${PRODUCT} dengan skor risiko ${ioc.riskScore.toFixed(1)}/100 ` +
        `(putusan ${ioc.verdict}, sumber indikator ${ioc.provenance})` +
        (ioc.impersonatedTarget ? `. Meniru: ${ioc.impersonatedTarget}` : '') +
        (ioc.ticket ? `. Tiket SOC ${ioc.ticket}` : ''),
      indicator_types: ['malicious-activity'],
      pattern: isIpv4(ioc.host)
        ? `[ipv4-addr:value = '${ioc.host}']`
        : `[domain-name:value = '${ioc.host}']`,
      pattern_type: 'stix',
      valid_from: ioc.firstSeenIso,
      labels: ['phishing', ioc.verdict.toLowerCase()],
    });
  }

  return JSON.stringify(
    { type: 'bundle', id: `bundle--${uuid()}`, objects },
    null,
    2,
  );
}

/* ---------------------------------- CSV ---------------------------------- */

export function renderCsv(iocs: readonly Ioc[]): string {
  const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['host', 'putusan', 'skor_risiko', 'sumber_indikator', 'meniru', 'tiket_soc', 'pertama_terlihat'],
    ...iocs.map((i) => [
      i.host,
      i.verdict,
      i.riskScore.toFixed(2),
      PROVENANCE_LABEL[i.provenance],
      i.impersonatedTarget ?? '',
      i.ticket ?? '',
      i.firstSeenIso,
    ]),
  ];
  // Semicolons because Excel in an id-ID locale splits on `;`; CRLF and a BOM
  // so it opens as UTF-8 with the columns intact.
  const body = rows.map((r) => r.map(cell).join(';')).join('\r\n');
  return `﻿${body}\r\n`;
}

/* -------------------------------- dispatch -------------------------------- */

export function renderFormat(format: FormatId, iocs: readonly Ioc[]): string {
  switch (format) {
    case 'rpz':
      return renderRpz(iocs);
    case 'dnsmasq':
      return renderDnsmasq(iocs);
    case 'hosts':
      return renderHosts(iocs);
    case 'pihole':
      return renderPihole(iocs);
    case 'pihole-regex':
      return renderPiholeRegex(iocs);
    case 'squid':
      return renderSquid(iocs);
    case 'suricata':
      return renderSuricata(iocs);
    case 'stix':
      return renderStix(iocs);
    case 'csv':
      return renderCsv(iocs);
  }
}

/** Client-side download: no server round trip, so this works on static hosting. */
export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
