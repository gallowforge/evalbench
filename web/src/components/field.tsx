import { type PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { VerdictModel } from '../api';
import { ms } from '../lib/format';
import { tone } from '../lib/theme';
import { type Decision, money, need, type Objective } from '../lib/verdict';

/** The lowest bar the page lets you set. Below half right, "good enough" stops meaning anything. */
export const MIN_BAR = 0.5;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

let pen: CanvasRenderingContext2D | null | undefined;

/** How wide the browser will draw a label, so labels can be kept off each other. An estimate where there is no canvas. */
function widthOf(text: string, px: number, weight: number): number {
  if (pen === undefined) {
    try {
      pen = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      pen = null;
    }
  }
  if (!pen) return text.length * px * 0.56;
  pen.font = `${weight} ${px}px "Schibsted Grotesk Variable", ui-sans-serif, system-ui, sans-serif`;
  return pen.measureText(text).width;
}

/** Round numbers a price axis can carry: every power of ten, or 1-2-5 steps when the range is short. */
function logTicks(lo: number, hi: number): number[] {
  const within = (steps: number[]) => {
    const out: number[] = [];
    for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)); k++) {
      for (const s of steps) {
        const v = s * 10 ** k;
        if (v >= lo && v <= hi) out.push(Number(v.toPrecision(6)));
      }
    }
    return out;
  };
  const decades = within([1]);
  return decades.length >= 2 ? decades : within([1, 2, 5]);
}

function linearTicks(hi: number): number[] {
  const rough = hi / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let v = 0; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}

const seconds = (v: number) => `${Number((v / 1000).toFixed(v < 10_000 ? 1 : 0))} s`;

/**
 * Every model as one dot: how often it is right against what it costs (or how long it takes).
 * The line is the bar. Whatever sits above it is good enough; the pick is the one furthest left.
 * Drag the line and the pick moves.
 */
export function FieldChart({
  models,
  decision,
  objective,
  onBar,
  height,
}: {
  models: VerdictModel[];
  decision: Decision;
  objective: Objective;
  onBar: (bar: number) => void;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const hatch = useId();
  const [width, setWidth] = useState(640);
  const [dragging, setDragging] = useState(false);
  // Labels are measured in the page's own face, so they are placed again once it has loaded.
  const [faces, setFaces] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFaces(1));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bar = decision.bar;
  const narrow = width < 520;
  const w = Math.max(280, width);
  const h = height ?? (narrow ? 350 : 450);
  // The top margin is tall enough for a two-line label above a model that got everything right.
  const pad = { l: 44, r: narrow ? 54 : 62, t: 48, b: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const bottom = pad.t + innerH;

  // The share axis starts a little under the weakest model, and never above 40%, so the bar always has room to move.
  const floor = useMemo(() => {
    const lo = Math.min(MIN_BAR, ...models.map((m) => m.pass_rate));
    return Math.max(0, Math.floor((lo - 0.05) * 10 + 1e-9) / 10);
  }, [models]);
  const y = (v: number) => pad.t + (1 - (Math.max(floor, v) - floor) / (1 - floor)) * innerH;
  const shareTicks = useMemo(() => {
    const step = 1 - floor <= 0.7 ? 0.1 : 0.2;
    const out: number[] = [];
    for (let v = 1; v >= floor - 1e-9; v -= step) out.push(Number(v.toFixed(2)));
    return out;
  }, [floor]);

  const scale = useMemo(() => {
    const value = (m: VerdictModel) => (objective === 'cost' ? m.cost : m.latency_ms);
    const known = models.map(value).filter((v): v is number => v !== null);
    const positive = known.filter((v) => v > 0);
    const unknown = models.some((m) => value(m) === null);
    const lane = narrow ? 44 : 64;
    const zeroLane = objective === 'cost' && known.some((v) => v === 0) ? lane : 0;
    const nullLane = unknown ? lane : 0;
    const x0 = pad.l + zeroLane + (zeroLane ? 14 : 8);
    const x1 = pad.l + innerW - nullLane - (nullLane ? 14 : 12);
    const span = Math.max(40, x1 - x0);
    let place: (v: number) => number = () => x0 + span / 2;
    let ticks: { x: number; label: string }[] = [];
    if (objective === 'cost' && positive.length) {
      const lo = Math.min(...positive) / (positive.length > 1 ? 1.8 : 3);
      const hi = Math.max(...positive) * (positive.length > 1 ? 1.8 : 3);
      place = (v) => x0 + (Math.log(v / lo) / Math.log(hi / lo)) * span;
      ticks = logTicks(lo, hi).map((v) => ({ x: place(v), label: money(v) }));
    } else if (objective === 'speed' && positive.length) {
      const top = linearTicks(Math.max(...positive) * 1.08);
      const hi = Math.max(top[top.length - 1], Math.max(...positive) * 1.08);
      place = (v) => x0 + (v / hi) * span;
      ticks = top.filter((v) => v > 0).map((v) => ({ x: place(v), label: seconds(v) }));
    }
    const zeroX = pad.l + zeroLane / 2;
    const nullX = pad.l + innerW - nullLane / 2;
    const x = (m: VerdictModel) => {
      const v = value(m);
      if (v === null) return nullX;
      if (v === 0 && objective === 'cost') return zeroX;
      return place(v);
    };
    return { x, ticks, zeroLane, nullLane, zeroX, nullX, x0, x1 };
  }, [models, objective, narrow, innerW, pad.l]);

  // Dots first, then a label for each: beside its dot where there is room, otherwise the first free spot around it.
  const marks = useMemo(() => {
    const seen = new Map<string, number>();
    const dots = models.map((m) => {
      let cx = scale.x(m);
      const cy = y(m.pass_rate);
      const key = `${Math.round(cx / 6)}:${Math.round(cy / 6)}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      cx += n * 17; // two models that scored and cost the same sit side by side, not on top of each other
      const row = decision.rows[m.id];
      const isPick = decision.pick === m.id;
      return { m, cx, cy, r: isPick ? 8 : 6.5, isPick, clears: !!row?.clears };
    });
    // The pick wears a ring, so it takes up more room than its dot.
    const obstacles: Box[] = dots.map((d) =>
      d.isPick
        ? { x0: d.cx - 23, x1: d.cx + 23, y0: d.cy - 17, y1: d.cy + 17 }
        : { x0: d.cx - d.r - 3, x1: d.cx + d.r + 3, y0: d.cy - d.r - 3, y1: d.cy + d.r + 3 },
    );
    // The bar is a line across the whole plot, and no label may be struck through by it.
    const line = y(decision.bar);
    const struck = (b: Box) => b.y0 < line + 4 && b.y1 > line - 4;
    // Nor may one sit on the handle at the end of the line, on the count written over it, or on the caption under it.
    const above = line > pad.t + 30;
    const fixed: Box[] = [{ x0: pad.l + innerW - 2, x1: w, y0: line - (above ? 34 : 16), y1: line + (above ? 16 : 38) }];
    if (bottom - line > 30)
      fixed.push({ x0: pad.l + innerW - 22 - widthOf('NOT GOOD ENOUGH', 11, 600), x1: pad.l + innerW, y0: bottom - 24, y1: bottom - 2 });
    const placed: Box[] = [];
    const order = [...dots].sort((a, b) => Number(b.isPick) - Number(a.isPick) || a.cy - b.cy);
    const labels = new Map<number, { x: number; y: number; anchor: 'start' | 'end' | 'middle'; sub: string }>();
    for (const d of order) {
      const m = d.m;
      const metric =
        objective === 'cost' ? (m.cost === null ? '' : m.cost === 0 ? '$0' : money(m.cost)) : m.latency_ms === null ? '' : ms(m.latency_ms);
      const sub = d.isPick ? `${m.passed} of ${m.attempted}${metric ? ` · ${metric}` : ''}` : '';
      const tw = Math.max(widthOf(m.label, d.isPick ? 15 : 13, d.isPick ? 700 : d.clears ? 600 : 500), sub ? widthOf(sub, 12, 500) : 0) + 4;
      const th = sub ? 34 : 18;
      // A model that clears the bar is labelled on the clear side of it; one that does not, underneath.
      const side = d.clears ? -1 : 1;
      type Spot = { x: number; y: number; anchor: 'start' | 'end' | 'middle' };
      // Beside the dot first, then around it on the right side of the bar, then the other side; then the same a step further out.
      const ring = (out: number): Spot[] => {
        const gap = d.r + (d.isPick ? 14 : 8) + out;
        const lift = th / 2 + 7 + out;
        const over = gap + th / 2;
        const around = (s: number): Spot[] => [
          { x: d.cx + gap, y: d.cy + s * lift, anchor: 'start' },
          { x: d.cx - gap, y: d.cy + s * lift, anchor: 'end' },
          { x: d.cx, y: d.cy + s * over, anchor: 'middle' },
          { x: d.cx - d.r, y: d.cy + s * over, anchor: 'start' },
          { x: d.cx + d.r, y: d.cy + s * over, anchor: 'end' },
        ];
        return [{ x: d.cx + gap, y: d.cy, anchor: 'start' }, { x: d.cx - gap, y: d.cy, anchor: 'end' }, ...around(side), ...around(-side)];
      };
      const spots = [...ring(0), ...ring(10)];
      const boxOf = (s: Spot): Box => {
        const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - tw : s.x - tw / 2;
        return { x0, x1: x0 + tw, y0: s.y - th / 2, y1: s.y + th / 2 };
      };
      // Inside the plot and clear of every other mark. `left` is how far left a label may reach: not over the scale, unless nothing else fits.
      const free = (b: Box, left: number) =>
        b.x0 >= left &&
        b.x1 <= w - 2 &&
        b.y0 >= 20 &&
        b.y1 <= bottom - 2 &&
        !fixed.some((f) => hit(f, b)) &&
        !placed.some((q) => hit(q, b)) &&
        !obstacles.some((o, i) => dots[i] !== d && hit(o, b));
      const boxes = spots.map(boxOf);
      const pick = (ok: (b: Box) => boolean) => {
        const i = boxes.findIndex(ok);
        return i < 0 ? null : spots[i];
      };
      const spot =
        pick((b) => free(b, pad.l - 2) && !struck(b)) ??
        pick((b) => free(b, 2) && !struck(b)) ??
        pick((b) => free(b, pad.l - 2)) ??
        pick((b) => free(b, 2)) ??
        spots[0];
      placed.push(boxOf(spot));
      labels.set(m.id, { ...spot, sub });
    }
    return dots.map((d) => ({ ...d, label: labels.get(d.m.id)! }));
  }, [models, decision, objective, scale, floor, innerH, innerW, w, faces]);

  const barY = y(bar);
  const fromPointer = (e: ReactPointerEvent) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const v = floor + (1 - (e.clientY - rect.top - pad.t) / innerH) * (1 - floor);
    onBar(Math.min(1, Math.max(MIN_BAR, Math.round(v * 100) / 100)));
  };
  const grab = {
    onPointerDown: (e: ReactPointerEvent<SVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      fromPointer(e);
    },
    onPointerMove: (e: ReactPointerEvent<SVGElement>) => dragging && fromPointer(e),
    onPointerUp: () => setDragging(false),
    onPointerCancel: () => setDragging(false),
  };

  const sample = models[0]?.attempted ?? 0;
  const axisTitle = objective === 'cost' ? 'Cost per 1,000 answers' : 'Median time per answer';
  const pick = marks.find((d) => d.isPick);
  const summary = models
    .map((m) => `${m.label} ${m.passed} of ${m.attempted}`)
    .concat(pick ? [`The pick is ${pick.m.label}`] : ['No model clears the bar'])
    .join('. ');

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        ref={svg}
        width={w}
        height={h}
        className="block overflow-visible"
        role="img"
        aria-label={`${axisTitle} against the share of answers right. ${summary}.`}
      >
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="stroke-ink" strokeOpacity={0.13} strokeWidth={1.2} />
          </pattern>
        </defs>

        {/* Share right: quiet rules, one per step. */}
        {shareTicks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={pad.l + innerW}
              y1={y(t)}
              y2={y(t)}
              className="stroke-ink"
              strokeOpacity={t === shareTicks[shareTicks.length - 1] ? 0.22 : 0.07}
            />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Everything under the bar is not good enough. */}
        {bottom - barY > 1 && <rect x={pad.l} y={barY} width={innerW} height={bottom - barY} fill={`url(#${hatch})`} />}
        {bottom - barY > 30 && (
          <text
            x={pad.l + innerW - 8}
            y={bottom - 10}
            textAnchor="end"
            className="fill-faint stroke-bg text-[11px] font-semibold tracking-[0.07em] uppercase"
            strokeWidth={5}
            style={{ paintOrder: 'stroke' }}
          >
            Not good enough
          </text>
        )}

        {/* The price axis. A model you run yourself costs nothing per answer, so it gets its own lane off the log scale. */}
        {scale.zeroLane > 0 && (
          <g>
            <text x={scale.zeroX} y={bottom + 18} textAnchor="middle" className="num fill-faint text-[11px]">
              $0
            </text>
            <path
              d={`M${pad.l + scale.zeroLane + 2},${bottom + 5} l5,-10 M${pad.l + scale.zeroLane + 7},${bottom + 5} l5,-10`}
              className="stroke-ink"
              strokeOpacity={0.35}
              fill="none"
            />
          </g>
        )}
        {scale.nullLane > 0 && (
          <text x={scale.nullX} y={bottom + 18} textAnchor="middle" className="fill-faint text-[11px]">
            {objective === 'cost' ? 'no price' : 'not timed'}
          </text>
        )}
        {scale.ticks.map((t) => (
          <g key={t.label}>
            <line x1={t.x} x2={t.x} y1={bottom} y2={bottom + 5} className="stroke-ink" strokeOpacity={0.3} />
            <text x={t.x} y={bottom + 18} textAnchor="middle" className="num fill-faint text-[11px]">
              {t.label}
            </text>
          </g>
        ))}
        <text x={pad.l + innerW} y={bottom + 40} textAnchor="end" className="fill-muted text-[12px] font-medium">
          {axisTitle}
          {objective === 'cost' && !narrow ? ', log scale' : ''}
        </text>
        <text x={pad.l} y={bottom + 40} className="fill-muted text-[12px] font-medium">
          {objective === 'cost' ? '← cheaper' : '← faster'}
        </text>
        <text x={pad.l} y={12} className="fill-muted text-[12px] font-medium">
          Answers right{sample ? `, of ${sample}` : ''}
        </text>

        {/* A plumb line from the pick to its price. */}
        {pick && (
          <line x1={pick.cx} x2={pick.cx} y1={pick.cy + pick.r + 6} y2={bottom} className="stroke-ink" strokeOpacity={0.3} strokeDasharray="2 4" />
        )}

        {marks.map((d) => (
          <g key={d.m.id}>
            <title>{`${d.m.label}: ${d.m.passed} of ${d.m.attempted} right${d.m.cost === null ? '' : `, ${money(d.m.cost)} per 1,000 answers`}${d.m.latency_ms === null ? '' : `, ${ms(d.m.latency_ms)} per answer`}`}</title>
            <circle
              cx={d.cx}
              cy={d.cy}
              r={d.r}
              strokeWidth={d.clears ? 2 : 2.2}
              className={d.clears ? 'stroke-bg' : 'fill-bg'}
              style={d.clears ? { fill: tone(d.m.color) } : { stroke: tone(d.m.color) }}
            />
            <text
              x={d.label.x}
              y={d.label.y + (d.label.sub ? -4 : 4.5)}
              textAnchor={d.label.anchor}
              strokeWidth={5}
              style={{ paintOrder: 'stroke' }}
              className={`stroke-bg ${d.isPick ? 'fill-ink text-[15px] font-bold' : d.clears ? 'fill-ink-2 text-[13px] font-semibold' : 'fill-muted text-[13px] font-medium'}`}
            >
              {d.m.label}
            </text>
            {d.label.sub && (
              <text
                x={d.label.x}
                y={d.label.y + 13}
                textAnchor={d.label.anchor}
                strokeWidth={5}
                style={{ paintOrder: 'stroke' }}
                className="num fill-muted stroke-bg text-[12px] font-medium"
              >
                {d.label.sub}
              </text>
            )}
          </g>
        ))}

        {/* The judge's ring around the pick, drawn again whenever the pick changes. */}
        {pick && (
          <svg
            key={pick.m.id}
            x={pick.cx - 21}
            y={pick.cy - 15}
            width={42}
            height={30}
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            className="overflow-visible"
            aria-hidden
          >
            <path
              d="M8,34 C6,16 30,5 54,6 C80,7 96,18 94,32 C92,48 70,56 46,55 C22,54 6,46 9,30 C11,20 22,13 34,10"
              pathLength={1}
              fill="none"
              stroke="var(--color-mark)"
              strokeWidth={2.4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="animate-draw"
            />
          </svg>
        )}

        {/* The bar: a line you can take hold of. */}
        <g aria-hidden>
          <line x1={pad.l} x2={pad.l + innerW + 6} y1={barY} y2={barY} className="stroke-ink" strokeWidth={dragging ? 2 : 1.5} />
          <rect x={pad.l} y={barY - 12} width={innerW} height={24} fill="transparent" style={{ cursor: 'ns-resize' }} {...grab} />
          <g style={{ cursor: 'ns-resize', touchAction: 'none' }} {...grab}>
            <rect x={pad.l + innerW + 6} y={barY - 13} width={pad.r - 8} height={26} rx={7} className="fill-ink" />
            <text x={pad.l + innerW + 6 + (pad.r - 8) / 2} y={barY + 4.5} textAnchor="middle" className="num fill-bg text-[13px] font-bold">
              {Math.round(bar * 100)}%
            </text>
            <rect x={pad.l + innerW - 6} y={barY - 22} width={pad.r + 8} height={44} fill="transparent" />
          </g>
          {sample > 0 && (
            <text
              x={pad.l + innerW + 6 + (pad.r - 8) / 2}
              y={barY + (barY > pad.t + 30 ? -20 : 30)}
              textAnchor="middle"
              className="num fill-muted text-[11px] font-medium"
            >
              {need(bar, sample)} of {sample}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
