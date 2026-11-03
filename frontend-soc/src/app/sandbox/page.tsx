import { ScanConsole } from '@/components/sandbox/ScanConsole';
import { id as t } from '@/lib/i18n/id';

export default function SandboxPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{t.scan.title}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Pindai tautan di dalam sandbox terisolasi, atau unggah poster dan tangkapan layar untuk
          analisis OCR, QR, dan pencatutan logo.
        </p>
      </header>
      <ScanConsole />
    </div>
  );
}
