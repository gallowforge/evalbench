import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type ThemePref, useTheme } from '../lib/theme';
import { cx } from './ui';

export const THEME_OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** The sun or moon in the top bar: a small menu of light, dark and system, remembered in this browser. */
export function ThemeMenu() {
  const { pref, theme, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[
      Math.max(
        0,
        THEME_OPTIONS.findIndex((o) => o.value === pref),
      )
    ]?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
    // Focus moves to the chosen item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const n = THEME_OPTIONS.length;
    const i = items.current.findIndex((el) => el === document.activeElement);
    const go = (k: number) => {
      e.preventDefault();
      items.current[(k + n) % n]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Hand focus back to the button first, so Tab carries on from there as the menu closes.
      button.current?.focus();
      setOpen(false);
    }
  };

  const current = THEME_OPTIONS.find((o) => o.value === pref)!;
  const Icon = theme === 'dark' ? Moon : Sun;
  const name = pref === 'system' ? `System, ${theme} now` : current.label;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        className="btn-quiet h-9 w-9 p-0"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${name}`}
        title={`Theme: ${name}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon size={17} />
      </button>
      {open && (
        <div
          ref={menu}
          className="animate-rise absolute top-full right-0 z-40 mt-2 w-[200px] rounded-[12px] border border-line-2 bg-panel p-1.5 shadow-[0_22px_48px_-20px_rgb(var(--shade)/0.55)]"
        >
          <div role="menu" aria-label="Theme" onKeyDown={onKey}>
            {THEME_OPTIONS.map((o, i) => {
              const on = pref === o.value;
              return (
                <button
                  key={o.value}
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  tabIndex={-1}
                  onClick={() => {
                    setPref(o.value);
                    close();
                  }}
                  className={cx(
                    'flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] transition-colors hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05]',
                    on ? 'font-semibold text-ink' : 'font-medium text-ink-2',
                  )}
                >
                  <o.icon size={15} className={on ? 'text-ink' : 'text-muted'} />
                  {o.label}
                  {o.value === 'system' && <span className="text-[12px] font-normal text-muted">{theme} now</span>}
                  {on && <Check size={15} strokeWidth={2.5} className="ml-auto text-accent" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-line px-2.5 pt-2 pb-0.5 text-[11.5px] text-muted">Saved in this browser.</div>
        </div>
      )}
    </div>
  );
}
