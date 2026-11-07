'use client';

/**
 * Working Dual-Theme Switcher (Dark Ops Carbon <-> Projector Paper Light).
 *
 * Updates `document.documentElement.dataset.theme`, `<meta name="color-scheme">`,
 * and `localStorage` ('vk:theme'), while staying deterministic during SSR via
 * `useSyncExternalStore` and syncing across browser tabs via `storage` events.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { id } from '@/lib/i18n/id';
import { IconMoon, IconSun } from './icons';

export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'vk:theme';
const THEME_EVENT = 'vk:theme-change';

function readThemeSnapshot(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribeTheme(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      applyThemeDom(e.newValue);
      onStoreChange();
    }
  };
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

function applyThemeDom(next: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', next);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore<ThemeMode>(
    subscribeTheme,
    readThemeSnapshot,
    () => 'dark',
  );

  const toggle = useCallback(() => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    applyThemeDom(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Restricted storage still switches current document cleanly.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, [theme]);

  const isDark = theme === 'dark';
  const actionLabel = isDark ? id.theme.switchToLight : id.theme.switchToDark;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={actionLabel}
      title={actionLabel}
      className={[
        'vk-btn vk-btn-secondary shrink-0',
        compact ? 'h-8 w-8 p-0' : 'h-8 w-full justify-between px-2.5 text-[0.75rem]',
      ].join(' ')}
    >
      {compact ? (
        isDark ? (
          <IconSun size={14} />
        ) : (
          <IconMoon size={14} />
        )
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 text-[var(--foreground)]">
            {isDark ? <IconMoon size={13} /> : <IconSun size={13} />}
            <span>{isDark ? id.theme.dark : id.theme.light}</span>
          </span>
          <span className="vk-mono text-[0.6875rem] text-[var(--muted)]">
            {isDark ? 'TERANG' : 'GELAP'}
          </span>
        </>
      )}
    </button>
  );
}

