/**
 * The server's arithmetic, in the browser: run summaries, Bradley-Terry ratings and their
 * bootstrap intervals. Each function follows its Python original line for line (evalbench/stats.py
 * and evalbench/ratings.py), down to how Python rounds and sums, so the demo shows the numbers
 * the real app would.
 */
import type { Summary } from '../api';
import { PythonRandom } from './mt19937';

/** Python's `round`: correctly rounded, and an exact half goes to the even neighbour. */
export function pyRound(x: number, digits = 0): number {
  const [whole, frac = ''] = x.toFixed(digits + 80).split('.');
  const rounded = Number(x.toFixed(digits));
  if (frac[digits] !== '5' || /[1-9]/.test(frac.slice(digits + 1))) return rounded;
  // An exact tie: `toFixed` went away from zero, Python goes to even.
  const last = Number(digits ? frac[digits - 1] : whole[whole.length - 1]);
  if (last % 2 === 0) return Number(`${whole}.${frac.slice(0, digits) || '0'}`);
  return rounded;
}

/** Python's `sum` over floats (Neumaier since 3.12): the lost low bits are carried along. */
export function pySum(values: number[]): number {
  let sum = 0;
  let carry = 0;
  for (const v of values) {
    const t = sum + v;
    carry += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  return sum + carry;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return pyRound(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, 1);
}

export interface Scored {
  status: string;
  task_id: string;
  category: string;
  passed: number | null;
  score: number | null;
  latency_ms: number | null;
  output_tokens: number | null;
}

/** An errored answer to a graded task counts as not passed (see `summarize` in stats.py). */
export function summarize(results: Scored[], unscored: ReadonlySet<string>): Summary {
  const done = results.filter((r) => r.status === 'done');
  const scored = done.filter((r) => r.passed !== null);
  const failedToAnswer = results.filter((r) => r.status === 'error' && !unscored.has(r.task_id));
  const attempted = scored.length + failedToAnswer.length;
  const passed = scored.reduce((n, r) => n + Number(r.passed), 0);
  const cats = new Map<string, number[]>();
  const add = (c: string, v: number) => cats.set(c, [...(cats.get(c) ?? []), v]);
  for (const r of scored) add(r.category, Number(r.passed));
  for (const r of failedToAnswer) add(r.category, 0);
  return {
    total: results.length,
    done: done.length,
    errors: results.filter((r) => r.status === 'error').length,
    pending: results.filter((r) => r.status === 'pending' || r.status === 'running').length,
    scored: scored.length,
    attempted,
    passed,
    pass_rate: attempted ? pyRound(passed / attempted, 4) : null,
    mean_score: attempted ? pyRound(pySum(scored.map((r) => r.score ?? 0)) / attempted, 4) : null,
    latency_ms: median(done.filter((r) => r.latency_ms !== null).map((r) => r.latency_ms as number)),
    output_tokens: done.length ? pyRound(done.reduce((n, r) => n + (r.output_tokens ?? 0), 0) / done.length) : null,
    categories: Object.fromEntries([...cats].map(([c, v]) => [c, pyRound(v.reduce((a, b) => a + b, 0) / v.length, 4)])),
  };
}

/** (model A, model B, score of A): 1 = A preferred, 0 = B preferred, 0.5 = about the same. */
export type Game = [number, number, number];

/** Strengths by minorise-maximise, reported on an Elo-like scale centred on 1000. */
export function bradleyTerry(games: Game[], prior = 1, iters = 300): Map<number, number> {
  const players = [...new Set(games.flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
  if (!players.length) return new Map();
  const at = new Map(players.map((p, i) => [p, i]));
  const size = players.length;
  const wins = new Array<number>(size).fill(0);
  const n = players.map(() => new Array<number>(size).fill(0));
  for (const [a, b, s] of games) {
    const i = at.get(a)!;
    const j = at.get(b)!;
    wins[i] += s;
    wins[j] += 1 - s;
    n[i][j] += 1;
    n[j][i] += 1;
  }
  let strength = new Array<number>(size).fill(1);
  for (let round = 0; round < iters; round++) {
    const next = strength.map((si, i) => {
      let denom = prior / (si + 1);
      for (let j = 0; j < size; j++) if (n[i][j]) denom += n[i][j] / (si + strength[j]);
      return (wins[i] + prior * 0.5) / denom;
    });
    const delta = Math.max(...next.map((v, i) => Math.abs(Math.log(v / strength[i]))));
    strength = next;
    if (delta < 1e-10) break;
  }
  const logs = strength.map((s) => Math.log10(s));
  const centre = pySum(logs) / size;
  return new Map(players.map((p, i) => [p, 1000 + 400 * (logs[i] - centre)]));
}

/** 95% intervals from resampling the ratings with replacement, on the server's own seed. */
export function bootstrap(games: Game[], rounds = 200, seed = 7): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  if (games.length < 2) return out;
  const rng = new PythonRandom(seed);
  const samples = new Map<number, number[]>();
  for (let round = 0; round < rounds; round++) {
    const resample = games.map(() => games[rng.randrange(games.length)]);
    for (const [p, r] of bradleyTerry(resample, 1, 120)) samples.set(p, [...(samples.get(p) ?? []), r]);
  }
  for (const [p, values] of samples) {
    values.sort((a, b) => a - b);
    out.set(p, [values[Math.trunc(0.025 * (values.length - 1))], values[Math.trunc(0.975 * (values.length - 1))]]);
  }
  return out;
}
