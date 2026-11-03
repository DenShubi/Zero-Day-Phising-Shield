import { id } from '@/lib/i18n/id';

export default function Loading() {
  return (
    <div className="flex items-center gap-3 p-8 text-sm text-[var(--muted)]">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-bright)]"
      />
      {id.common.loading}
    </div>
  );
}
