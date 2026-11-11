import { describe, expect, it } from 'vitest';
import { fields } from './answer';

describe('an answer that is one flat JSON object', () => {
  it('is read as its fields, in the order written', () => {
    expect(fields('{"category": "billing", "urgency": "high", "reply": "We are on it."}')).toEqual([
      ['category', 'billing'],
      ['urgency', 'high'],
      ['reply', 'We are on it.'],
    ]);
    expect(fields('  {"ok": true, "count": 3, "note": null}\n')).toEqual([
      ['ok', 'true'],
      ['count', '3'],
      ['note', 'null'],
    ]);
  });

  it('is left alone when it is anything else', () => {
    expect(fields('The answer is {"a": 1}')).toBeNull();
    expect(fields('[1, 2, 3]')).toBeNull();
    expect(fields('{"a": {"b": 1}}')).toBeNull();
    expect(fields('{"a": [1]}')).toBeNull();
    expect(fields('{}')).toBeNull();
    expect(fields('{"category": "billing"')).toBeNull();
    expect(fields('')).toBeNull();
  });
});
