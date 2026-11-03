import { WaSimulator } from '@/components/whatsapp/WaSimulator';
import { id as t } from '@/lib/i18n/id';

export default function WhatsAppPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{t.nav.whatsapp}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Bagaimana seorang prajurit melaporkan tautan atau poster mencurigakan dari ponsel, dan
          menerima putusan forensik dalam hitungan detik.
        </p>
      </header>
      <WaSimulator />
    </div>
  );
}
