import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { id } from '@/lib/i18n/id';

/**
 * Self-hosted Geist Sans & Geist Mono via next/font/local rather than
 * next/font/google: the build host may be on a slow or filtered link, and a
 * network font fetch failing at build time would break deploys. Serving local
 * woff2 files from public/fonts/ keeps both builds and offline projector demos
 * completely self-contained.
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
  title: `${id.app.name}: ${id.app.subtitle}`,
  description:
    'Konsol komando SOC untuk deteksi phishing zero-day: sandbox URL terisolasi, forensik visual ber-bounding-box, analisis QR/OCR, dan ekspor blocklist DNS.',
  other: {
    'page-type': 'software',
    'site-kind': 'software',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="id"
      data-type="software"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
