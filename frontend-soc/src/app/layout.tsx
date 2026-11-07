import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { id } from '@/lib/i18n/id';

/**
 * Self-hosted Geist Sans & Geist Mono via next/font/local rather than
 * next/font/google: zero network requests at build time or during offline
 * conference demos.
 */
const geistSans = localFont({
  src: '../../public/fonts/geist-latin.woff2',
  variable: '--font-sans',
  weight: '100 900',
  display: 'swap',
});

const geistMono = localFont({
  src: '../../public/fonts/geist-mono-latin.woff2',
  variable: '--font-mono',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: `${id.app.name} | ${id.app.subtitle}`,
  description:
    'Konsol inventaris SOC dan triase forensik phishing zero-day: sandbox URL terisolasi, bukti visual ber-bounding-box, ekstraksi QR/OCR, dan ekspor aturan DNS Sinkhole.',
  other: {
    'page-type': 'software',
    'site-kind': 'software',
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('vk:theme');var t=(s==='light'||s==='dark')?s:'dark';document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="color-scheme"]');if(m)m.setAttribute('content',t);}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="id"
      data-type="software"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
