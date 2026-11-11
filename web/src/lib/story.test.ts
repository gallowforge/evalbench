import { describe, expect, it } from 'vitest';
import type { Verdict } from '../api';
import snapshotData from '../demo/data/snapshots.json';
import { headline, holding, judges, plain, standing } from './story';
import { decide, type Objective } from './verdict';

// The sentences are read against the demo workspace as captured from the server, so a change to
// the sample data or to the rule shows up here as a changed sentence.
const bodies = (snapshotData as unknown as { bodies: Record<string, Verdict> }).bodies;
const triage = bodies['/verdict/support-triage'];
const battery = bodies['/verdict/core-battery'];

function read(v: Verdict, bar: number, objective: Objective = 'cost') {
  const d = decide(v.models, bar, objective);
  const h = headline(v.models, d);
  return { d, text: [h.title, ...h.lines.map(plain)] };
}

describe('the headline', () => {
  it('names the cheapest model that clears the bar, and what the best one would cost', () => {
    expect(read(triage, 0.9).text).toEqual([
      'Use Orion Mini.',
      'It gets 22 of 24 right for $0.12 per 1,000 answers.',
      'Nimbus Pro gets all 24, at 26× the price.',
    ]);
  });

  it('follows the bar', () => {
    expect(read(triage, 0.8).text).toEqual([
      'Use Atlas 70B.',
      'It gets 21 of 24 right with no API bill.',
      'Nimbus Pro gets all 24, for $3.03 per 1,000 answers.',
    ]);
    expect(read(triage, 0.95).text).toEqual(['Use Nimbus Pro.', 'It gets all 24 right for $3.03 per 1,000 answers.', 'Nothing scores higher.']);
  });

  it('can prefer speed', () => {
    expect(read(triage, 0.9, 'speed').text).toEqual([
      'Use Orion Mini.',
      'It gets 22 of 24 right in 625 ms per answer.',
      'Nimbus Pro gets all 24, but takes 3× as long.',
    ]);
  });

  it('says so when nothing is good enough', () => {
    expect(read(battery, 0.9).text).toEqual(['Use Atlas 70B.', 'It gets 18 of 20 right with no API bill.', 'Nothing scores higher.']);
    expect(read(battery, 0.95).text).toEqual([
      'No model is good enough yet.',
      'The bar is 95%: 19 of 20. Atlas 70B comes closest with 18, 1 short.',
      'Lower the bar, fix the prompt or add a stronger model.',
    ]);
  });

  it('says a bar that is not a whole percent as it is', () => {
    expect(read(battery, 0.925).text[1]).toBe('The bar is 92.5%: 19 of 20. Atlas 70B comes closest with 18, 1 short.');
  });

  it('has something to say before the first run', () => {
    expect(headline([], decide([], 0.9, 'cost')).title).toBe('Nothing to decide yet.');
  });
});

describe('where each model stands', () => {
  const rows = (v: Verdict, bar: number, objective: Objective = 'cost') => {
    const d = decide(v.models, bar, objective);
    return Object.fromEntries(v.models.map((m) => [m.label, standing(m, v.models, d)]));
  };

  it('tells the pick from the rest', () => {
    const r = rows(triage, 0.9);
    expect(r['Orion Mini']).toEqual({ kind: 'pick', label: 'The pick', note: '' });
    expect(r['Nimbus Pro']).toEqual({ kind: 'clears', label: 'Clears the bar', note: '26× the price of the pick' });
    expect(r['Atlas 70B']).toEqual({ kind: 'short', label: '1 short', note: '' });
    expect(r['Lyra Flash']).toEqual({ kind: 'short', label: '2 short', note: 'Atlas 70B is cheaper and more accurate' });
    expect(r['Vega 8B']).toEqual({ kind: 'short', label: '7 short', note: 'Atlas 70B is more accurate at the same price' });
  });

  it('names the model that makes another one pointless', () => {
    expect(rows(battery, 0.9)['Nimbus Pro']).toEqual({ kind: 'clears', label: 'Clears the bar', note: 'Atlas 70B is as accurate and cheaper' });
    expect(rows(triage, 0.9, 'speed')['Nimbus Pro'].note).toBe('Takes 3× as long as the pick');
  });
});

describe('what the judges say', () => {
  const say = (v: Verdict, bar: number) => judges(v.models, v.human, decide(v.models, bar, 'cost').pick).map(plain);

  it('separates a clear preference from a lean', () => {
    expect(say(triage, 0.9)).toEqual([
      'Judges clearly prefer Nimbus Pro to Orion Mini (1,302 against 1,029).',
      'They also lean towards Atlas 70B (1,079 against 1,029), but the ranges overlap: 151 ratings cannot separate the two yet.',
    ]);
    expect(say(battery, 0.9)).toEqual([
      'Judges lean towards Nimbus Pro over Atlas 70B (1,142 against 1,118), but the ranges overlap: 88 ratings cannot separate the two yet.',
    ]);
  });

  it('agrees when the pick is also the favourite', () => {
    expect(say(triage, 0.95)).toEqual(['Judges agree: they prefer Nimbus Pro too, and clearly.']);
  });

  it('does not invent an opinion', () => {
    expect(judges(triage.models, { models: {}, h2h: {}, count: 0 }, 3).map(plain)).toEqual(['Nobody has judged these answers yet.']);
  });
});

describe('whether the answer holds', () => {
  const name = (id: number) => ({ 2: 'Atlas 70B', 3: 'Orion Mini' })[id] ?? String(id);

  it('counts the runs that agree', () => {
    expect(holding([3, 3, 3], 3, name)).toBe('The answer has been Orion Mini on all 3 runs.');
    expect(holding([null, null, null, 2, 2, 2], 2, name)).toBe(
      'The answer has been Atlas 70B for the last 3 runs. Before that no model cleared the bar.',
    );
    expect(holding([3, 3, 2], 2, name)).toBe('The answer has been Atlas 70B for the last run. Before that it was Orion Mini.');
    expect(holding([2, null, null], null, name)).toBe('No model cleared this bar in the last 2 runs. Before that the answer was Atlas 70B.');
    expect(holding([null, null], null, name)).toBe('No model has cleared this bar in any of the 2 runs.');
    expect(holding([3], 3, name)).toBe('One run so far. Run it again to see whether the answer holds.');
  });

  it('says when the latest run alone would answer differently', () => {
    expect(holding([3, 2], 3, name)).toBe(
      "The answer has been Atlas 70B for the last run. Before that it was Orion Mini. Counting each model's latest run, today's answer is Orion Mini.",
    );
    expect(holding([3, 3], null, name)).toBe(
      "The answer has been Orion Mini on all 2 runs. Counting each model's latest run, no model clears the bar today.",
    );
  });
});
