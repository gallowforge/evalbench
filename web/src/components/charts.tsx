import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, ModelRef } from '../api';
import { pct, shortDate } from '../lib/format';
import { ModelDot } from './ui';

/** Pass rate per model across runs: one 2px line per model, a crosshair and a tooltip on hover. */
export function HistoryChart({ board, height = 240 }: { board: Board; height?: number }) {
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

  const pad = { l: 40, r: 16, t: 14, b: 30 };
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

  if (!points.length) return <div className="py-10 text-center text-[13px] text-muted">Runs will show up here.</div>;

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
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="#ffffff" strokeOpacity={t === 0 ? 0.12 : 0.05} />
              <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="fill-faint text-[10.5px] num">
                {t * 100}%
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.run_id} x={x(i)} y={h - 8} textAnchor="middle" className="fill-faint text-[10.5px]">
              {points.length > 8 && i % 2 ? '' : `#${p.run_id}`}
            </text>
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="#ffffff" strokeOpacity={0.18} strokeDasharray="3 3" />
          )}
          {series.map(({ model, pts }) => (
            <g key={model.id}>
              <path
                d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={model.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 4.5 : 3} fill={model.color} stroke="#111418" strokeWidth={2} />
              ))}
            </g>
          ))}
        </svg>
        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[180px] rounded-[10px] border border-line-2 bg-[#171b22f2] px-3 py-2.5 shadow-[0_12px_32px_-12px_#000] backdrop-blur"
            style={{ left: Math.min(x(hover) + 12, w - 200), top: 8 }}
          >
            <div className="mb-1.5 text-[11.5px] text-muted">
              Run #{hp.run_id} · {shortDate(hp.created_at)}
              {hp.label ? ` · ${hp.label}` : ''}
            </div>
            {ordered.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-4 text-[12.5px] py-0.5">
                <span className="flex items-center gap-2 text-ink-2">
                  <ModelDot color={m.color} size={7} />
                  {m.label}
                </span>
                <span className="num font-semibold text-ink">{pct(hp.models[String(m.id)].pass_rate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Legend models={models} />
    </div>
  );
}

export function Legend({ models }: { models: ModelRef[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {models.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-2 text-[12px] text-ink-2">
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: m.color }} />
          {m.label}
        </span>
      ))}
    </div>
  );
}

export function Sparkline({ values, color, width = 96, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => 3 + (1 - v) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={`${d} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={color} fillOpacity={0.09} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} fill={color} />
    </svg>
  );
}

/** Pass rate per category, one thin bar per model in fixed model order. */
export function CategoryBars({ board }: { board: Board }) {
  const [hover, setHover] = useState<string | null>(null);
  const models = board.models.filter((m) => m.auto);
  return (
    <div className="space-y-4">
      {board.categories.map((cat) => (
        <div key={cat}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-ink-2 capitalize">{cat}</span>
          </div>
          <div className="space-y-[3px]">
            {models.map((m) => {
              const v = m.auto?.categories[cat] ?? 0;
              const key = `${cat}:${m.id}`;
              return (
                <div key={m.id} className="group flex items-center gap-3" onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
                  <div className="relative h-[9px] flex-1 rounded-[4px] bg-white/[0.04]">
                    <div
                      className="h-full rounded-[4px] transition-[width] duration-500"
                      style={{ width: `${Math.max(v * 100, 1.5)}%`, background: m.color, opacity: hover && hover !== key ? 0.45 : 1 }}
                    />
                  </div>
                  <span className={`num w-10 text-right text-[11.5px] ${hover === key ? 'text-ink' : 'text-muted'}`}>{pct(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Head-to-head win rate: row model vs column model, shaded on one blue ramp. */
export function WinMatrix({ board }: { board: Board }) {
  const models = board.models.filter((m) => m.human);
  const [hover, setHover] = useState<string | null>(null);
  if (models.length < 2) return <div className="py-8 text-center text-[13px] text-muted">Rate a few pairs to see head-to-head results.</div>;
  const cell = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const c = board.h2h[key];
    if (!c || !c.games) return null;
    const lowWins = c.wins / c.games;
    return { rate: a < b ? lowWins : 1 - lowWins, games: c.games };
  };
  const ramp = (v: number) => {
    // one hue, light to dark against the dark surface: low = recessive, high = saturated
    const steps = ['#163052', '#1c4a80', '#2565b0', '#3987e5', '#6da7ec'];
    return steps[Math.min(steps.length - 1, Math.floor(v * steps.length))];
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th />
            {models.map((m) => (
              <th key={m.id} className="pb-1.5 text-[11px] font-medium text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <ModelDot color={m.color} size={6} />
                  {m.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((row) => (
            <tr key={row.id}>
              <td className="pr-2 text-right text-[11.5px] text-ink-2 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <ModelDot color={row.color} size={6} />
                  {row.label}
                </span>
              </td>
              {models.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="h-10 rounded-[6px] bg-white/[0.02]" />;
                const c = cell(row.id, col.id);
                const key = `${row.id}:${col.id}`;
                return (
                  <td
                    key={col.id}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    title={c ? `${row.label} preferred over ${col.label} in ${pct(c.rate)} of ${c.games} ratings` : 'No ratings yet'}
                    className="h-10 min-w-16 rounded-[6px] text-center text-[12px] font-semibold num transition-[filter]"
                    style={{
                      background: c ? ramp(c.rate) : '#ffffff05',
                      color: c && c.rate >= 0.6 ? '#04111f' : '#e6ecf5',
                      filter: hover === key ? 'brightness(1.25)' : undefined,
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
      <div className="mt-2 text-[11.5px] text-faint">Share of ratings where the row model was preferred. Ties count half.</div>
    </div>
  );
}

/** Bradley-Terry rating with its 95% interval, on a shared scale across rows. */
export function RatingBar({ rating, ci, domain, color }: { rating: number; ci: [number, number] | null; domain: [number, number]; color: string }) {
  const [lo, hi] = domain;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.07]" />
      {ci && (
        <div
          className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full"
          style={{ left: pos(ci[0]), width: `calc(${pos(ci[1])} - ${pos(ci[0])})`, background: color, opacity: 0.28 }}
        />
      )}
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel"
        style={{ left: pos(rating), background: color }}
      />
    </div>
  );
}
