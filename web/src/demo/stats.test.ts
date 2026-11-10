import { describe, expect, it } from 'vitest';
import { PythonRandom } from './mt19937';
import { bootstrap, bradleyTerry, type Game, pyRound, pySum, summarize } from './stats';

// Every expected value here was printed by Python 3.14, the interpreter the server runs on.

describe('python arithmetic', () => {
  it('draws the numbers random.Random(7) draws', () => {
    const a = new PythonRandom(7);
    expect(Array.from({ length: 12 }, () => a.randrange(88))).toEqual([41, 19, 50, 83, 6, 9, 68, 12, 46, 74, 7, 64]);
    const b = new PythonRandom(7);
    expect(Array.from({ length: 12 }, () => b.randrange(5))).toEqual([2, 1, 3, 0, 0, 4, 0, 2, 4, 0, 4, 1]);
  });

  it('rounds an exact half to the even neighbour, and everything else to the nearest', () => {
    expect(pyRound(0.03125, 4)).toBe(0.0312);
    expect(pyRound(12.5)).toBe(12);
    expect(pyRound(13.5)).toBe(14);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(0.85, 4)).toBe(0.85);
    expect(pyRound(1046.449, 1)).toBe(1046.4);
    expect(pyRound(-0.5)).toBe(-0);
  });

  it('sums floats without losing the low bits', () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(pySum([1, 1e100, 1, -1e100])).toBe(2);
    expect(pySum([])).toBe(0);
  });
});

describe('summaries and ratings', () => {
  const row = (task_id: string, status: string, passed: number | null, score: number | null, latency_ms: number | null = 1000) => ({
    task_id,
    status,
    passed,
    score,
    latency_ms,
    category: task_id[0] === 'r' ? 'reasoning' : 'debugging',
    output_tokens: 10,
  });

  it('counts a failed answer to a graded task as not passed, and leaves ungraded tasks out', () => {
    const s = summarize(
      [
        row('r1', 'done', 1, 1, 900),
        row('r2', 'done', 0, 0.5, 1100),
        row('d1', 'error', null, null, null),
        row('d2', 'done', null, null),
        row('d3', 'error', null, null),
        row('d4', 'pending', null, null),
      ],
      new Set(['d2', 'd3']),
    );
    expect(s).toMatchObject({
      total: 6,
      done: 3,
      errors: 2,
      pending: 1,
      scored: 2,
      attempted: 3,
      passed: 1,
      pass_rate: 0.3333,
      mean_score: 0.5,
      latency_ms: 1000,
    });
    expect(s.categories).toEqual({ reasoning: 0.5, debugging: 0 });
  });

  it('has no rate before anything is graded', () => {
    expect(summarize([row('r1', 'pending', null, null, null)], new Set())).toMatchObject({
      pass_rate: null,
      mean_score: null,
      latency_ms: null,
      output_tokens: null,
    });
  });

  const games: Game[] = [
    [1, 2, 1],
    [2, 1, 0.5],
    [1, 3, 0],
    [3, 2, 1],
    [2, 3, 1],
    [1, 3, 1],
  ];

  it('rates models as the server does', () => {
    const r = bradleyTerry(games);
    expect(r.get(1)).toBeCloseTo(1050.5752179839153, 9);
    expect(r.get(2)).toBeCloseTo(949.4247820156327, 9);
    expect(r.get(3)).toBeCloseTo(1000.0000000004519, 9);
    expect(bradleyTerry([]).size).toBe(0);
  });

  it('resamples on the same seed, so the intervals match too', () => {
    const ci = bootstrap(games);
    expect(ci.get(1)![0]).toBeCloseTo(838.8283656630745, 8);
    expect(ci.get(1)![1]).toBeCloseTo(1307.3160935203216, 8);
    expect(ci.get(2)![0]).toBeCloseTo(679.8947444715396, 8);
    expect(ci.get(2)![1]).toBeCloseTo(1104.7447364284048, 8);
    expect(ci.get(3)![0]).toBeCloseTo(719.2852571953661, 8);
    expect(ci.get(3)![1]).toBeCloseTo(1264.592839823597, 8);
    expect(bootstrap([[1, 2, 1]]).size).toBe(0);
  });
});
