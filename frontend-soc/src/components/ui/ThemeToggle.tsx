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
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
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

export function ThemeToggle() {
  const theme = useSyncExternalStore<ThemeMode>(
    subscribeTheme,
    readThemeSnapshot,
    () => 'light',
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
      className="vk-btn vk-btn-ghost h-8 w-8 shrink-0 p-0 text-[var(--muted)]"
    >
      {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
    </button>
  );
}

