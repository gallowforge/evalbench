import { describe, expect, it } from 'vitest';
import cases from '../../../tests/verdict-cases.json';
import { type Candidate, decide, money, need, type Objective, times, wilson } from './verdict';

// The same cases the Python tests run (tests/test_verdict.py): the page and the server must agree.

describe('need', () => {
  for (const c of cases.need) {
    it(`${c.bar} of ${c.attempted}`, () => expect(need(c.bar, c.attempted)).toBe(c.need));
  }
});

describe('wilson', () => {
  for (const c of cases.wilson) {
    it(`${c.passed} of ${c.attempted}`, () => {
      const got = wilson(c.passed, c.attempted);
      if (c.interval === null) return expect(got).toBeNull();
      expect(got![0]).toBeCloseTo(c.interval[0], 4);
      expect(got![1]).toBeCloseTo(c.interval[1], 4);
    });
  }
});

describe('decide', () => {
  for (const c of cases.decide) {
    it(c.name, () => {
      const got = decide(c.candidates as Candidate[], c.bar, c.objective as Objective);
      const want = c.expect as { pick: number | null; order: number[]; best: number | null; unranked: number[]; rows?: Record<string, unknown> };
      expect(got.pick).toBe(want.pick);
      expect(got.order).toEqual(want.order);
      expect(got.best).toBe(want.best);
      expect(got.unranked).toEqual(want.unranked);
      for (const [id, row] of Object.entries(want.rows ?? {})) expect(got.rows[id]).toEqual(row);
    });
  }
});

describe('money', () => {
  it('uses the digits the amount needs', () => {
    expect([0, 0.0312, 0.12, 0.7, 2.61, 48.5, 1234.5].map(money)).toEqual(['$0', '$0.031', '$0.12', '$0.70', '$2.61', '$48.50', '$1,235']);
  });
  it('says how many times the price', () => {
    expect([21.75, 3.44, 1.2, 10].map(times)).toEqual(['22×', '3.4×', '1.2×', '10×']);
  });
});
