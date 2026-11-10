/**
 * The verdict rule, in the browser. `need`, `wilson` and `decide` are twins of the functions in
 * evalbench/verdict.py: the page moves the bar and re-decides without asking the server, and both
 * sides run the cases in tests/verdict-cases.json, so they cannot drift apart.
 */

export const DEFAULT_BAR = 0.9;

export type Objective = 'cost' | 'speed';

export interface Candidate {
  id: number;
  passed: number;
  attempted: number;
  /** Dollars per 1,000 answers. Null when the model has no price; zero for one you run yourself. */
  cost?: number | null;
  latency_ms?: number | null;
}

export interface DecisionRow {
  need: number;
  margin: number;
  clears: boolean;
  beaten_by: number[];
}

export interface Decision {
  bar: number;
  objective: Objective;
  pick: number | null;
  /** Every model that clears the bar, the one to use first. */
  order: number[];
  /** The most accurate model, whatever it costs. */
  best: number | null;
  /** Models that clear the bar but have no number to rank them by. */
  unranked: number[];
  rows: Record<string, DecisionRow>;
}

/** The fewest right answers out of `attempted` that reach the bar. */
export function need(bar: number, attempted: number): number {
  return Math.max(0, Math.ceil(bar * attempted - 1e-9));
}

/** The range the true pass rate plausibly lies in (Wilson score interval, 95%). */
export function wilson(passed: number, attempted: number, z = 1.96): [number, number] | null {
  if (!attempted) return null;
  const p = passed / attempted;
  const d = 1 + (z * z) / attempted;
  const centre = (p + (z * z) / (2 * attempted)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / attempted + (z * z) / (4 * attempted * attempted))) / d;
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

type Key = (number | boolean)[];

function compare(a: Key, b: Key): number {
  for (let i = 0; i < a.length; i++) {
    const d = Number(a[i]) - Number(b[i]);
    if (d) return d;
  }
  return 0;
}

/**
 * Which model to use. A model clears the bar when its share of right answers is at or above it;
 * among those the pick is the cheapest (or the fastest), and a tie goes to the more accurate one.
 * A model without the number being optimised ranks after the ones that have it.
 */
export function decide(candidates: Candidate[], bar: number = DEFAULT_BAR, objective: Objective = 'cost'): Decision {
  const [metric, other] = objective === 'cost' ? (['cost', 'latency_ms'] as const) : (['latency_ms', 'cost'] as const);
  const judged = candidates.filter((c) => c.attempted);
  const rate = (c: Candidate) => c.passed / c.attempted;
  const value = (c: Candidate, key: 'cost' | 'latency_ms') => c[key] ?? null;
  const byMetric = (c: Candidate): Key => {
    const a = value(c, metric);
    const b = value(c, other);
    return [a === null, a ?? 0, -rate(c), b === null, b ?? 0, c.id];
  };
  const byRate = (c: Candidate): Key => {
    const a = value(c, metric);
    return [-rate(c), a === null, a ?? 0, c.id];
  };

  const rows: Record<string, DecisionRow> = {};
  for (const c of judged) {
    const n = need(bar, c.attempted);
    rows[c.id] = { need: n, margin: c.passed - n, clears: c.passed >= n, beaten_by: [] };
  }
  // Beaten: another model is at least as accurate and at least as cheap (or fast), and strictly
  // better on one of the two. A beaten model is never worth choosing, at any bar.
  for (const c of judged) {
    const mine = value(c, metric);
    if (mine === null) continue;
    const better = judged.filter((o) => {
      const theirs = value(o, metric);
      return o.id !== c.id && theirs !== null && rate(o) >= rate(c) && theirs <= mine && (rate(o) > rate(c) || theirs < mine);
    });
    rows[c.id].beaten_by = better.sort((a, b) => compare(byMetric(a), byMetric(b))).map((o) => o.id);
  }
  const order = judged
    .filter((c) => rows[c.id].clears)
    .sort((a, b) => compare(byMetric(a), byMetric(b)))
    .map((c) => c.id);
  const ranked = [...judged].sort((a, b) => compare(byRate(a), byRate(b)));
  const known = new Set(judged.filter((c) => value(c, metric) !== null).map((c) => c.id));
  return {
    bar,
    objective,
    pick: order.length ? order[0] : null,
    order,
    best: ranked.length ? ranked[0].id : null,
    unranked: order.filter((id) => !known.has(id)),
    rows,
  };
}

/** Dollars, with as many digits as the amount needs: $0, $0.031, $0.12, $2.61, $1,234. */
export function money(x: number): string {
  if (x === 0) return '$0';
  if (x < 0.995) return `$${x.toFixed(x >= 0.095 ? 2 : 3)}`;
  const digits = x < 100 ? 2 : 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** How many times the price: 22×, 3.4×, 1.2×. */
export function times(ratio: number): string {
  return `${ratio >= 10 ? Math.round(ratio) : Number(ratio.toFixed(1))}×`;
}
