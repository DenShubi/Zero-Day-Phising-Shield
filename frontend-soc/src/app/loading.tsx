import { id } from '@/lib/i18n/id';

export default function Loading() {
  return (
    <section className="vk-panel-section">
      <div className="flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]">
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
        />
        <span>{id.common.loading}</span>
      </div>
    </section>
  );
}
