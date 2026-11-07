import Link from 'next/link';
import { id } from '@/lib/i18n/id';

export default function NotFound() {
  return (
    <section className="vk-panel-section p-4 sm:p-6">
      <div className="mx-auto my-auto w-full max-w-xl rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-0)] p-6">
        <h1
          id="vk-main-heading"
          tabIndex={-1}
          className="text-[1.25rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none"
        >
          {id.errors.notFoundTitle}
        </h1>
        <p className="mt-2 text-[0.875rem] leading-[1.55] text-[var(--muted-strong)]">
          {id.errors.notFoundBody}
        </p>
        <Link href="/" className="vk-btn vk-btn-primary mt-4 h-9 px-4 text-[0.8125rem] no-underline">
          {id.errors.backToCommand}
        </Link>
      </div>
    </section>
  );
}
