import Link from 'next/link';
import { id } from '@/lib/i18n/id';

export default function NotFound() {
  return (
    <section className="vk-panel-section">
      <div className="mx-auto my-auto w-full max-w-xl">
        <div className="vk-bento p-6">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {id.errors.notFoundTitle}
          </h1>
          <p className="mt-2 text-[1rem] leading-[1.55] text-[var(--muted-strong)]">
            {id.errors.notFoundBody}
          </p>
          <Link href="/" className="vk-btn vk-btn-primary mt-4 h-9 px-4 text-[0.875rem] no-underline">
            {id.errors.backToCommand}
          </Link>
        </div>
      </div>
    </section>
  );
}
