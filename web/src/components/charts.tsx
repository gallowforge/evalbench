import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, ModelRef } from '../api';
import { pct, shortDate } from '../lib/format';
import { ModelDot } from './ui';

/** Pass rate per model across runs: one line per model, labelled at its end, with a hover rule. */
export function HistoryChart({ board, height = 260 }: { board: Board; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const models = board.models;
  const points = board.history;

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
  const y = (v: number) => pad.t + (1 - v) * innerH;

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
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="#17181c" strokeOpacity={t === 0 ? 0.22 : 0.07} />
              <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
                {t * 100}%
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.run_id} x={x(i)} y={h - 9} textAnchor="middle" className="fill-faint text-[11px]">
              {points.length > 8 && i % 2 ? '' : `#${p.run_id}`}
            </text>
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="#17181c" strokeOpacity={0.25} strokeDasharray="3 3" />
          )}
          {series.map(({ model, pts }) => (
            <g key={model.id}>
              <path
                d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={model.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 5 : 3.5} fill={model.color} stroke="#fffdf8" strokeWidth={2} />
              ))}
            </g>
          ))}
          {labelled &&
            ends.map((e) => (
              <text key={e.model.id} x={w - pad.r + 12} y={e.y + 4} className="text-[12px] font-semibold" fill={e.model.color}>
                {e.model.label}
              </text>
            ))}
        </svg>
        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[200px] rounded-[12px] border border-line bg-panel px-3.5 py-3 shadow-[0_16px_40px_-16px_rgba(23,24,28,0.45)]"
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
    </div>
  );
}

export function Legend({ models }: { models: ModelRef[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {models.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <span className="h-[3px] w-4 rounded-full" style={{ background: m.color }} />
          {m.label}
        </span>
      ))}
    </div>
  );
}

export function Sparkline({ values, color, width = 104, height = 30 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => 4 + (1 - v) * (height - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3} fill={color} stroke="#fffdf8" strokeWidth={1.5} />
    </svg>
  );
}

/** Pass rate per category: one row per category, one thin bar per model in fixed model order. */
export function CategoryBars({ board }: { board: Board }) {
  const [hover, setHover] = useState<string | null>(null);
  const models = board.models.filter((m) => m.auto);
  return (
    <div className="space-y-6">
      {board.categories.map((cat) => (
        <div key={cat}>
          <div className="mb-2.5 text-[14px] font-semibold capitalize text-ink">{cat}</div>
          <div className="space-y-[5px]">
            {models.map((m) => {
              const v = m.auto?.categories[cat] ?? 0;
              const key = `${cat}:${m.id}`;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3"
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  title={`${m.label}: ${pct(v)}`}
                >
                  <div className="relative h-[8px] flex-1 rounded-full bg-ink/[0.06]">
                    <div
                      className="h-full rounded-full transition-[width,opacity] duration-500"
                      style={{ width: `${Math.max(v * 100, 1.5)}%`, background: m.color, opacity: hover && hover !== key ? 0.4 : 1 }}
                    />
                  </div>
                  <span className={`num w-11 text-right text-[12.5px] font-semibold ${hover === key ? 'text-ink' : 'text-muted'}`}>{pct(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Head-to-head preference: row model against column model, on one azure ramp. */
export function WinMatrix({ board }: { board: Board }) {
  const models = board.models.filter((m) => m.human);
  const [hover, setHover] = useState<string | null>(null);
  if (models.length < 2) return <div className="py-10 text-center text-[14px] text-muted">Judge a few pairs to see head-to-head results.</div>;
  const cell = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const c = board.h2h[key];
    if (!c || !c.games) return null;
    const lowWins = c.wins / c.games;
    return { rate: a < b ? lowWins : 1 - lowWins, games: c.games };
  };
  const ramp = ['#eef2fd', '#d3defb', '#a9bff6', '#6f93ee', '#2457f0'];
  const shade = (v: number) => ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
  return (
    <div className="overflow-x-auto">
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
              <td className="whitespace-nowrap pr-3 text-right text-[13px] font-medium text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <ModelDot color={row.color} size={7} />
                  {row.label}
                </span>
              </td>
              {models.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="h-11 rounded-[8px] bg-ink/[0.03]" />;
                const c = cell(row.id, col.id);
                const key = `${row.id}:${col.id}`;
                return (
                  <td
                    key={col.id}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    title={c ? `${row.label} preferred over ${col.label} in ${pct(c.rate)} of ${c.games} ratings` : 'No ratings yet'}
                    className="num h-11 min-w-16 rounded-[8px] text-center text-[13.5px] font-bold transition-[filter]"
                    style={{
                      background: c ? shade(c.rate) : '#17181c08',
                      color: c && c.rate >= 0.6 ? '#ffffff' : '#17181c',
                      filter: hover === key ? 'brightness(0.94)' : undefined,
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
          style={{ left: pos(ci[0]), width: `calc(${pos(ci[1])} - ${pos(ci[0])})`, background: color, opacity: 0.25 }}
        />
      )}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-panel"
        style={{ left: pos(rating), background: color }}
      />
    </div>
  );
}
