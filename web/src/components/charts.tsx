import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '../api';
import { pct, shortDate } from '../lib/format';
import { share } from '../lib/verdict';
import { ModelDot } from './ui';
import { tone } from '../lib/theme';

export interface HistoryPoint {
  run_id: number;
  label: string;
  created_at: string;
  models: Record<string, { pass_rate: number }>;
}

/**
 * Pass rate per model across runs: one line per model, labelled at its end, with a hover rule.
 * Given a bar it draws the line a model has to reach, and given each run's pick it rings it.
 */
export function HistoryChart({
  models,
  history: points,
  height = 260,
  bar,
  picks,
}: {
  models: ModelRef[];
  history: HistoryPoint[];
  height?: number;
  bar?: number;
  picks?: (number | null)[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [points.length > 0]);

  const labelled = width > 560;
  const longest = Math.max(0, ...models.map((m) => m.label.length));
  const pad = { l: 42, r: labelled ? Math.min(190, 24 + longest * 7.2) : 14, t: 14, b: 32 };
  const w = Math.max(220, width);
  const h = height;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  // The share axis starts at the nearest quarter under the weakest run, so close races are not squeezed into the top of the plot.
  const lowest = Math.min(bar ?? 1, ...points.flatMap((p) => Object.values(p.models).map((m) => m.pass_rate)));
  const floor = [0.5, 0.25].find((f) => lowest - 0.04 >= f) ?? 0;
  const ticks = floor === 0.5 ? [0.5, 0.6, 0.7, 0.8, 0.9, 1] : floor === 0.25 ? [0.25, 0.5, 0.75, 1] : [0, 0.25, 0.5, 0.75, 1];
  const y = (v: number) => pad.t + (1 - (v - floor) / (1 - floor)) * innerH;

  const series = useMemo(
    () =>
      models.map((m) => ({
        model: m,
        pts: points.map((p, i) => ({ i, v: p.models[String(m.id)]?.pass_rate })).filter((p): p is { i: number; v: number } => p.v !== undefined),
      })),
    [models, points],
  );

  if (!points.length) return <div className="py-12 text-center text-[14px] text-muted">Runs will show up here.</div>;

  // End labels, nudged apart so they never collide.
  const ends = series
    .filter((s) => s.pts.length)
    .map((s) => ({ model: s.model, y: y(s.pts[s.pts.length - 1].v), v: s.pts[s.pts.length - 1].v }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 17) ends[i].y = ends[i - 1].y + 17;
  // If the nudging ran past the bottom of the plot, shift the whole stack back up.
  const overflow = ends.length ? ends[ends.length - 1].y - (pad.t + innerH + 4) : 0;
  if (overflow > 0) for (const e of ends) e.y -= overflow;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    let best = 0;
    let dist = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  const ordered = hp
    ? [...models].filter((m) => hp.models[String(m.id)]).sort((a, b) => hp.models[String(b.id)].pass_rate - hp.models[String(a.id)].pass_rate)
    : [];

  return (
    <div>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={w} height={h} className="block" role="img" aria-label="Pass rate by run for each model">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="stroke-ink" strokeOpacity={t === floor ? 0.22 : 0.07} />
              <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.run_id} x={x(i)} y={h - 9} textAnchor="middle" className="fill-faint text-[11px]">
              {points.length > 8 && i % 2 ? '' : `#${p.run_id}`}
            </text>
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} className="stroke-ink" strokeOpacity={0.25} strokeDasharray="3 3" />
          )}
          {bar !== undefined && (
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y(bar)}
              y2={y(bar)}
              className="stroke-ink"
              strokeWidth={1.5}
              strokeDasharray="1 5"
              strokeLinecap="round"
            />
          )}
          {series.map(({ model, pts }) => (
            <g key={model.id}>
              <path
                d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                fill="none"
                style={{ stroke: tone(model.color) }}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)}
                  cy={y(p.v)}
                  r={hover === p.i ? 5 : 3.5}
                  className="stroke-bg"
                  style={{ fill: tone(model.color) }}
                  strokeWidth={2}
                />
              ))}
            </g>
          ))}
          {picks?.map((id, i) => {
            const v = id === null ? undefined : points[i]?.models[String(id)]?.pass_rate;
            return v === undefined ? null : (
              <circle key={points[i].run_id} cx={x(i)} cy={y(v)} r={8.5} fill="none" stroke="var(--color-mark)" strokeWidth={2} />
            );
          })}
          {labelled &&
            ends.map((e) => (
              // The label is set in ink; the short stroke beside it carries the model's colour.
              <g key={e.model.id}>
                <line
                  x1={w - pad.r + 10}
                  x2={w - pad.r + 20}
                  y1={e.y}
                  y2={e.y}
                  style={{ stroke: tone(e.model.color) }}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                <text x={w - pad.r + 26} y={e.y + 4} className="fill-ink-2 text-[12px] font-semibold">
                  {e.model.label}
                </text>
              </g>
            ))}
        </svg>
        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[200px] rounded-[12px] border border-line bg-panel px-3.5 py-3 shadow-[0_16px_40px_-16px_rgb(var(--shade)/0.45)]"
            style={{ left: Math.min(x(hover) + 14, w - 220), top: 6 }}
          >
            <div className="mb-2 text-[12px] text-muted">
              Run #{hp.run_id} · {shortDate(hp.created_at)}
              {hp.label ? ` · ${hp.label}` : ''}
            </div>
            {ordered.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-5 py-0.5 text-[13px]">
                <span className="flex items-center gap-2 text-ink-2">
                  <ModelDot color={m.color} size={8} />
                  {m.label}
                </span>
                <span className="num font-bold text-ink">{pct(hp.models[String(m.id)].pass_rate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!labelled && <Legend models={models} />}
      {/* The bar and the ring are named under the plot, where no line can cross the words. */}
      {bar !== undefined && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12.5px] text-muted"
          style={labelled ? { paddingLeft: pad.l } : undefined}
        >
          <span className="inline-flex items-center gap-2">
            <svg width={22} height={4} aria-hidden>
              <line x1={1} x2={21} y1={2} y2={2} className="stroke-ink" strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round" />
            </svg>
            The bar, {share(bar)}
          </span>
          {picks?.some((p) => p !== null) && (
            <span className="inline-flex items-center gap-2">
              <span className="h-[13px] w-[13px] rounded-full border-2 border-mark" aria-hidden />
              The answer on that run
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function Legend({ models }: { models: ModelRef[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {models.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <span className="h-[3px] w-4 rounded-full" style={{ background: tone(m.color) }} />
          {m.label}
        </span>
      ))}
    </div>
  );
}

/** Head-to-head preference: row model against column model, on one azure ramp. */
export function WinMatrix({ models, h2h }: { models: ModelRef[]; h2h: Record<string, { wins: number; games: number }> }) {
  const [hover, setHover] = useState<string | null>(null);
  if (models.length < 2) return <div className="py-10 text-center text-[14px] text-muted">Judge a few pairs to see head-to-head results.</div>;
  const cell = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const c = h2h[key];
    if (!c || !c.games) return null;
    const lowWins = c.wins / c.games;
    return { rate: a < b ? lowWins : 1 - lowWins, games: c.games };
  };
  // One ink ramp, pale to solid: the heavier the cell, the more often the row model won (index.css, --heat-*).
  const step = (v: number) => Math.min(5, Math.floor(v * 5) + 1);
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Head to head win rates">
      <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
        <thead>
          <tr>
            <th />
            {models.map((m) => (
              <th key={m.id} className="pb-2 text-[12px] font-semibold text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <ModelDot color={m.color} size={7} />
                  {m.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((row) => (
            <tr key={row.id}>
              <td className="pr-3 text-right text-[13px] font-medium text-ink-2 sm:whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <ModelDot color={row.color} size={7} />
                  {row.label}
                </span>
              </td>
              {models.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="h-11 rounded-[6px] bg-ink/[0.03]" />;
                const c = cell(row.id, col.id);
                const key = `${row.id}:${col.id}`;
                return (
                  <td
                    key={col.id}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    title={c ? `${row.label} preferred over ${col.label} in ${pct(c.rate)} of ${c.games} ratings` : 'No ratings yet'}
                    className="num h-11 min-w-12 rounded-[6px] text-center text-[13.5px] font-bold transition-[filter]"
                    style={{
                      background: c ? `var(--heat-${step(c.rate)})` : 'var(--heat-0)',
                      color: c && step(c.rate) === 5 ? 'var(--heat-ink-5)' : 'var(--heat-ink)',
                      filter: hover === key ? 'var(--heat-hover)' : undefined,
                    }}
                  >
                    {c ? pct(c.rate) : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-[12.5px] text-muted">How often the row model was preferred over the column model. Ties count half.</div>
    </div>
  );
}

/** Bradley-Terry rating with its 95% interval, on a scale shared by every row. */
export function RatingBar({ rating, ci, domain, color }: { rating: number; ci: [number, number] | null; domain: [number, number]; color: string }) {
  const [lo, hi] = domain;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="relative h-6 w-full">
      <div className="absolute inset-x-0 top-1/2 h-px bg-ink/[0.12]" />
      {ci && (
        <div
          className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full"
          style={{ left: pos(ci[0]), width: `calc(${pos(ci[1])} - ${pos(ci[0])})`, background: tone(color), opacity: 0.25 }}
        />
      )}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-bg"
        style={{ left: pos(rating), background: tone(color) }}
      />
    </div>
  );
}
