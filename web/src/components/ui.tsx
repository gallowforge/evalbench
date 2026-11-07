import { AlertTriangle, Check, CircleDashed, Loader2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { ModelRef, Result, RunStatus } from '../api';

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
    <header className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[12.5px] text-muted">{eyebrow}</div>}
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] text-muted max-w-[72ch]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

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
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-0">
          {title && <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cx(pad && 'p-5', pad && !!(title || action) && 'pt-3.5')}>{children}</div>
    </section>
  );
}

export function ModelDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 0 3px ${color}22` }}
    />
  );
}

export function ModelChip({ model, className }: { model: ModelRef; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 min-w-0', className)}>
      <ModelDot color={model.color} />
      <span className="truncate font-medium text-ink">{model.label}</span>
    </span>
  );
}

const STATUS: Record<RunStatus, { label: string; tone: string; dot: string }> = {
  queued: { label: 'Queued', tone: 'text-ink-2', dot: 'bg-muted' },
  running: { label: 'Running', tone: 'text-accent', dot: 'bg-accent animate-pulse-soft' },
  done: { label: 'Done', tone: 'text-good-ink', dot: 'bg-good' },
  failed: { label: 'Failed', tone: 'text-bad-ink', dot: 'bg-bad' },
  cancelled: { label: 'Cancelled', tone: 'text-muted', dot: 'bg-faint' },
  interrupted: { label: 'Interrupted', tone: 'text-warn', dot: 'bg-warn' },
};

export function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', s.tone)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

export function Bar({
  value,
  color = 'var(--color-accent)',
  height = 6,
  track = '#ffffff0d',
}: {
  value: number | null;
  color?: string;
  height?: number;
  track?: string;
}) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: track }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className)} size={16} />;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-16 justify-center text-muted text-[13px]">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="mb-4 grid h-11 w-11 place-items-center rounded-[12px] border border-line-2 bg-white/[0.03] text-muted">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-[46ch] text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad-ink">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** One result in the matrix: green check, red cross, amber partial, grey error, or pending. */
export function ResultCell({ result, onClick, active }: { result?: Result; onClick?: () => void; active?: boolean }) {
  let body: ReactNode;
  let tone = 'border-line bg-white/[0.02] text-faint';
  let title = 'No answer';
  if (!result || result.status === 'pending') {
    body = <CircleDashed size={13} />;
    title = 'Waiting';
  } else if (result.status === 'running') {
    body = <Loader2 size={13} className="animate-spin text-accent" />;
    tone = 'border-accent/40 bg-accent/10';
    title = 'Running';
  } else if (result.status === 'error') {
    body = <AlertTriangle size={13} />;
    tone = 'border-serious/35 bg-serious/10 text-serious';
    title = result.error ?? 'Error';
  } else if (result.passed === null) {
    body = <span className="text-[11px]">–</span>;
    title = 'No automatic checks';
  } else if (result.passed) {
    body = <Check size={14} strokeWidth={2.6} />;
    tone = 'border-good/35 bg-good/[0.16] text-good-ink';
    title = 'All checks passed';
  } else if ((result.score ?? 0) > 0) {
    const passed = result.checks.filter((c) => c.passed).length;
    body = (
      <span className="num text-[11px] font-semibold">
        {passed}/{result.checks.length}
      </span>
    );
    tone = 'border-warn/35 bg-warn/[0.13] text-warn';
    title = `${passed} of ${result.checks.length} checks passed`;
  } else {
    body = <X size={14} strokeWidth={2.6} />;
    tone = 'border-bad/40 bg-bad/[0.16] text-bad-ink';
    title = 'Failed';
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'grid h-8 w-full min-w-11 place-items-center rounded-[8px] border transition-all hover:brightness-125',
        tone,
        active && 'ring-2 ring-accent/70 ring-offset-2 ring-offset-panel',
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
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="animate-rise relative card max-h-[88vh] w-full flex flex-col shadow-[0_40px_120px_-30px_#000]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" className="btn-quiet h-8 w-8 p-0" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>}
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
    <div className="inline-flex rounded-[10px] border border-line-2 bg-[#0d1014] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[8px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 h-7 text-[12px]' : 'px-3 h-8 text-[13px]',
            value === o.value ? 'bg-white/[0.09] text-ink shadow-[inset_0_1px_0_#ffffff14]' : 'text-muted hover:text-ink',
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
    <div className="flex gap-1 border-b border-line mb-5">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            'relative px-3 h-10 text-[13.5px] font-medium transition-colors',
            value === t.value ? 'text-ink' : 'text-muted hover:text-ink-2',
          )}
        >
          {t.label}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="card p-5 relative overflow-hidden">
      {accent && <div className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />}
      <div className="label">{label}</div>
      <div className={cx('num mt-2.5 text-[30px] leading-none font-semibold tracking-[-0.02em]', accent ? 'text-accent' : 'text-ink')}>{value}</div>
      {hint && <div className="mt-2 text-[12.5px] text-muted">{hint}</div>}
    </div>
  );
}
