import { AlertTriangle, Check, Loader2, SearchX, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { ApiError, type ModelRef, type Result, type RunStatus } from '../api';
import { tone } from '../lib/theme';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-9 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-[820px]">
        {eyebrow && <div className="mb-3 text-[13.5px] text-muted">{eyebrow}</div>}
        <h1 className="text-[34px] leading-[1.04] font-bold tracking-[-0.035em] text-balance text-ink md:text-[44px]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-[64ch] text-[16px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/**
 * One ruled section of a sheet: its name in the margin, its content beside it. Pages are built
 * from these instead of boxes, so the eye follows one left edge down the page. `tight` is for the
 * working pages, where the sections are short and many.
 */
export function Section({
  title,
  note,
  first,
  tight,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  first?: boolean;
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        'grid gap-x-12 md:grid-cols-[190px_minmax(0,1fr)]',
        tight ? 'gap-y-4 py-8 md:py-10' : 'gap-y-6 py-11 md:py-14',
        first ? 'border-t-2 border-ink' : 'border-t border-line',
      )}
    >
      <div>
        <h2 className="text-[19px] leading-[1.25] font-bold tracking-[-0.015em] text-balance">{title}</h2>
        {note && <div className="mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-muted">{note}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A titled sheet. `pad={false}` for lists that run edge to edge. */
export function Card({
  children,
  className,
  title,
  action,
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-4 px-6 pt-5">
          {title && <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cx(pad && 'px-6 pb-6', pad && !!(title || action) ? 'pt-4' : pad && 'pt-6')}>{children}</div>
    </section>
  );
}

export function ModelDot({ color, size = 9 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: tone(color) }} />;
}

export function ModelChip({ model, className }: { model: ModelRef; className?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>
      <ModelDot color={model.color} />
      <span className="truncate font-medium text-ink">{model.label}</span>
    </span>
  );
}

const STATUS: Record<RunStatus, { label: string; tone: string; dot: string }> = {
  queued: { label: 'Queued', tone: 'text-muted', dot: 'bg-faint' },
  running: { label: 'Running', tone: 'text-accent', dot: 'bg-accent animate-pulse-soft' },
  done: { label: 'Done', tone: 'text-good', dot: 'bg-good' },
  failed: { label: 'Failed', tone: 'text-bad-ink', dot: 'bg-bad' },
  cancelled: { label: 'Cancelled', tone: 'text-muted', dot: 'bg-faint' },
  interrupted: { label: 'Interrupted', tone: 'text-warn', dot: 'bg-warn' },
};

export function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13px] font-semibold', s.tone)}>
      <span className={cx('h-[7px] w-[7px] rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

export function Bar({ value, color = 'var(--color-ink)', height = 6 }: { value: number | null; color?: string; height?: number }) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div className="w-full overflow-hidden rounded-full bg-ink/[0.07]" style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className)} size={16} />;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-[14px] text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-5 grid h-12 w-12 place-items-center rounded-[14px] bg-ink/[0.05] text-ink-2">{icon}</div>}
      <div className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
      {children && <div className="mt-2 max-w-[48ch] text-[14.5px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** True when the server says the thing asked for does not exist. */
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/** A page whose record is gone or never was: say so plainly and offer the way back. */
export function NotFound({ what, href, back }: { what: string; href: string; back: string }) {
  return (
    <Empty
      icon={<SearchX size={20} />}
      title={`No such ${what}`}
      action={
        <Link href={href} className="btn-ghost">
          {back}
        </Link>
      }
    >
      It may have been deleted, or the link has a typo in it.
    </Empty>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-bad/25 bg-bad-tint px-3.5 py-2.5 text-[14px] text-bad-ink">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** One verdict in the results grid: a tick, a cross, a partial score, an error or waiting. */
export function ResultCell({ result, onClick, active }: { result?: Result; onClick?: () => void; active?: boolean }) {
  let body: ReactNode;
  let tone = 'border-dashed border-line-2 text-faint';
  let title = 'No answer';
  if (!result || result.status === 'pending') {
    body = <span className="h-1 w-1 rounded-full bg-faint" />;
    title = 'Waiting';
  } else if (result.status === 'running') {
    body = <Loader2 size={13} className="animate-spin text-accent" />;
    tone = 'border-accent/40 bg-accent/[0.06]';
    title = 'Running';
  } else if (result.status === 'error') {
    body = <AlertTriangle size={13} />;
    tone = 'border-serious/40 text-serious';
    title = result.error ?? 'Error';
  } else if (result.passed === null) {
    body = <span className="text-[12px]">–</span>;
    title = 'No automatic checks';
  } else if (result.passed) {
    // Passing is the expected case, so it stays quiet: the eye should land on what failed.
    body = <Check size={14} strokeWidth={2.4} />;
    tone = 'border-transparent bg-ink/[0.07] text-muted';
    title = 'All checks passed';
  } else if ((result.score ?? 0) > 0) {
    const passed = result.checks.filter((c) => c.passed).length;
    body = (
      <span className="num text-[12px] font-bold">
        {passed}/{result.checks.length}
      </span>
    );
    tone = 'border-transparent bg-warn-tint text-warn';
    title = `${passed} of ${result.checks.length} checks passed`;
  } else {
    body = <X size={15} strokeWidth={2.8} />;
    tone = 'border-transparent bg-mark text-white';
    title = 'Failed';
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'grid h-8 w-full min-w-12 place-items-center rounded-[5px] border transition-all hover:-translate-y-px hover:shadow-[0_4px_12px_-6px_rgb(var(--shade)/0.4)]',
        tone,
        active && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
      )}
    >
      {body}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center p-4">
      <div className="absolute inset-0 bg-scrim backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="animate-rise card relative flex max-h-[88vh] w-full flex-col shadow-[0_40px_100px_-30px_rgb(var(--shade)/0.55)]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
          <button type="button" className="btn-quiet h-9 w-9 p-0" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
        {footer && <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12.5px] leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-[10px] bg-ink/[0.06] p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[8px] font-semibold transition-all',
            size === 'sm' ? 'h-7 px-3 text-[12.5px]' : 'h-8 px-3.5 text-[13.5px]',
            value === o.value ? 'bg-panel text-ink shadow-[0_1px_3px_rgb(var(--shade)/0.15)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-6 flex gap-6 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-selected={value === t.value}
          role="tab"
          onClick={() => onChange(t.value)}
          className={cx('relative h-11 text-[15px] font-semibold transition-colors', value === t.value ? 'text-ink' : 'text-muted hover:text-ink-2')}
        >
          {t.label}
          {value === t.value && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink" />}
        </button>
      ))}
    </div>
  );
}

/** A big figure: the number is the point, the words explain it. */
export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className="text-[13.5px] font-semibold text-muted">{label}</div>
      <div className={cx('slab mt-1 text-[44px] leading-none font-semibold', accent ? 'text-accent' : 'text-ink')}>{value}</div>
      {hint && <div className="mt-2 text-[13.5px] text-muted">{hint}</div>}
    </div>
  );
}

/** The judge's mark: a hand-drawn loop, drawn on when it appears. */
export function PenRing({ className, color = 'var(--color-mark)' }: { className?: string; color?: string }) {
  return (
    <svg className={cx('pointer-events-none absolute overflow-visible', className)} viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
      <path
        pathLength={1}
        className="animate-draw"
        d="M8,34 C6,16 30,5 54,6 C80,7 96,18 94,32 C92,48 70,56 46,55 C22,54 6,46 9,30 C11,20 22,13 34,10"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A pen tick, for a chosen winner. */
export function PenTick({ size = 18, color = 'var(--color-mark)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <path
        pathLength={1}
        className="animate-draw"
        d="M3.5 10.5 L8 15 L16.5 4.5"
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
