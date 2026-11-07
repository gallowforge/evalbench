export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return `${(v * 100).toFixed(digits)}%`;
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)} s`;
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v >= 10_000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function thousands(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return v.toLocaleString('en-US');
}

const units: [number, string][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.35, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '–';
  let delta = (now - new Date(iso).getTime()) / 1000;
  if (delta < 45) return 'just now';
  for (const [size, name] of units) {
    if (delta < size) {
      const n = Math.round(delta);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
    delta /= size;
  }
  return '–';
}

export function duration(start: string | null, end: string | null, now: number = Date.now()): string {
  if (!start) return '–';
  const s = Math.max(0, ((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function plural(n: number, word: string, many?: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : (many ?? `${word}s`)}`;
}
