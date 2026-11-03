import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { id } from '@/lib/i18n/id';

/**
 * System fonts rather than next/font/google: the build host may be on a slow or
 * filtered link, and a font fetch failing at build time would be a needless way
 * to break a deploy. It also keeps the offline demo path intact.
 */

export const metadata: Metadata = {
  title: `${id.app.name} — ${id.app.subtitle}`,
  description:
    'Pusat komando SOC untuk deteksi dan penangkalan phishing bertema TNI AD: sandbox URL, forensik visual, analisis QR/OCR, dan mitigasi DNS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
