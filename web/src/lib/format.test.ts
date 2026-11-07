import { describe, expect, it } from 'vitest';
import { ago, compact, duration, ms, pct, plural, titleCase } from './format';

describe('format', () => {
  it('formats rates and durations', () => {
    expect(pct(0.857)).toBe('86%');
    expect(pct(0.857, 1)).toBe('85.7%');
    expect(pct(null)).toBe('–');
    expect(ms(840)).toBe('840 ms');
    expect(ms(2450)).toBe('2.5 s');
    expect(ms(42_000)).toBe('42 s');
    expect(compact(1234)).toBe('1.2k');
    expect(compact(56_000)).toBe('56k');
  });

  it('describes time in words', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    expect(ago('2026-01-10T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-01-10T11:00:00Z', now)).toBe('1 hour ago');
    expect(ago('2026-01-03T12:00:00Z', now)).toBe('1 week ago');
    expect(duration('2026-01-10T11:58:00Z', '2026-01-10T12:00:05Z', now)).toBe('2m 5s');
  });

  it('labels things', () => {
    expect(titleCase('instruction_following')).toBe('Instruction following');
    expect(plural(1, 'task')).toBe('1 task');
    expect(plural(1200, 'rating')).toBe('1,200 ratings');
  });
});
