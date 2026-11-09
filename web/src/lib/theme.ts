import { useSyncExternalStore } from 'react';

/**
 * Light, dark, or whatever the device asks for. The choice is remembered in this browser only.
 * index.html applies it before the first paint, so a page never flashes the wrong theme;
 * this module keeps it applied afterwards and lets React read and change it.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'evalbench:theme';
const PAPER: Record<Theme, string> = { light: '#f3f0e8', dark: '#121110' };
const listeners = new Set<() => void>();
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = typeof window === 'undefined' ? 'system' : read();

export function resolveTheme(p: ThemePref): Theme {
  if (p !== 'system') return p;
  return typeof window !== 'undefined' && darkQuery().matches ? 'dark' : 'light';
}

function apply() {
  const root = document.documentElement;
  const next = resolveTheme(pref);
  if (root.dataset.theme !== next) {
    // Swap every colour in one frame rather than letting each transition-colors element fade on its own.
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[next]);
  listeners.forEach((l) => l());
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage can be blocked (private windows); the choice then lasts for this visit.
  }
  apply();
}

/** Follow the device while the choice is "system", and keep other open tabs in step. */
export function startTheme() {
  darkQuery().addEventListener('change', () => pref === 'system' && apply());
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    pref = read();
    apply();
  });
  apply();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => pref);
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme(pref));
  return { pref: current, theme: resolved, setPref: setThemePref };
}

// The documented categorical palette. In the dark theme each slot takes its own dark step,
// defined as --series-<hex> in index.css; any other colour a model was given is used as is.
const SERIES = new Set(['2a78d6', 'eb6834', '1baf7a', 'eda100', 'e87ba4', '008300', '6250d6', 'e34948']);

/** A model's colour, ready for the current theme. Safe to call twice. */
export function tone(color: string): string;
export function tone(color: string | undefined): string | undefined;
export function tone(color: string | undefined) {
  const hex = color?.trim().toLowerCase().replace(/^#/, '');
  return hex && SERIES.has(hex) ? `var(--series-${hex}, #${hex})` : color;
}
