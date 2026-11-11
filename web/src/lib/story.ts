/**
 * The verdict in words. The page shows a decision, so every number on it has to arrive inside a
 * sentence a person can act on. These are pure functions over what was measured: the page renders
 * the parts, and the tests read them back as plain text.
 */
import type { Verdict, VerdictModel } from '../api';
import { ms } from './format';
import { type Decision, money, type Objective, share, times } from './verdict';

/** A run of text, or a run to set in bold. */
export type Part = string | { b: string };

export const plain = (parts: Part[]): string => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

export type Measured = Pick<VerdictModel, 'id' | 'label' | 'passed' | 'attempted' | 'pass_rate' | 'cost' | 'latency_ms'>;

/** "all 24", or "22 of 24". */
const count = (m: Measured) => (m.passed === m.attempted && m.attempted > 1 ? `all ${m.attempted}` : `${m.passed} of ${m.attempted}`);

const runs = (n: number) => (n === 1 ? 'run' : `${n} runs`);

/** The headline and the two sentences under it. */
export function headline(models: Measured[], d: Decision): { title: string; lines: Part[][] } {
  const by = new Map(models.map((m) => [m.id, m]));
  const pick = d.pick === null ? undefined : by.get(d.pick);
  const best = d.best === null ? undefined : by.get(d.best);
  if (!best) {
    return { title: 'Nothing to decide yet.', lines: [['No answer has been graded for this job. Run it against a model or two.']] };
  }
  if (!pick) {
    const row = d.rows[best.id];
    return {
      title: 'No model is good enough yet.',
      lines: [
        [
          'The bar is ',
          { b: share(d.bar) },
          `: ${row.need} of ${best.attempted}. `,
          { b: best.label },
          ` comes closest with ${best.passed}, ${-row.margin} short.`,
        ],
        ['Lower the bar, fix the prompt or add a stronger model.'],
      ],
    };
  }

  const first: Part[] = ['It gets ', { b: count(pick) }, ' right'];
  if (d.objective === 'speed') {
    if (pick.latency_ms === null) first.push('. Its speed was not measured.');
    else first.push(' in ', { b: ms(pick.latency_ms) }, ' per answer.');
  } else if (pick.cost === null) first.push('. It has no price set, so cost was not compared.');
  else if (pick.cost === 0) first.push(' with ', { b: 'no API bill' }, '.');
  else first.push(' for ', { b: money(pick.cost) }, ' per 1,000 answers.');

  if (best.id === pick.id || best.pass_rate <= pick.pass_rate) return { title: `Use ${pick.label}.`, lines: [first, ['Nothing scores higher.']] };

  const second: Part[] = [{ b: best.label }, ` gets ${count(best)}`];
  if (d.objective === 'speed') {
    const ratio = pick.latency_ms && best.latency_ms ? best.latency_ms / pick.latency_ms : 0;
    if (ratio >= 1.05) second.push(', but takes ', { b: times(ratio) }, ' as long.');
    else second.push('.');
  } else if (pick.cost && best.cost) second.push(', at ', { b: times(best.cost / pick.cost) }, ' the price.');
  else if (pick.cost === 0 && best.cost) second.push(', for ', { b: money(best.cost) }, ' per 1,000 answers.');
  else second.push('.');
  return { title: `Use ${pick.label}.`, lines: [first, second] };
}

const metric = (m: Measured, objective: Objective) => (objective === 'cost' ? m.cost : m.latency_ms);

/** Why another model makes this one pointless: "cheaper and more accurate". */
function edge(rival: Measured, m: Measured, objective: Objective): string {
  const [less, same] = objective === 'cost' ? ['cheaper', 'at the same price'] : ['faster', 'at the same speed'];
  const a = metric(rival, objective);
  const b = metric(m, objective);
  if (rival.pass_rate > m.pass_rate) return a !== null && b !== null && a < b ? `${less} and more accurate` : `more accurate ${same}`;
  return `as accurate and ${less}`;
}

export interface Standing {
  kind: 'pick' | 'clears' | 'short';
  label: string;
  /** One more line when there is something worth knowing: who beats it, or what it costs next to the pick. */
  note: string;
}

/** Where one model stands in the decision, for its row in the ledger. */
export function standing(m: Measured, models: Measured[], d: Decision): Standing {
  const row = d.rows[m.id];
  if (!row) return { kind: 'short', label: 'Not graded', note: '' };
  if (d.pick === m.id) return { kind: 'pick', label: 'The pick', note: '' };
  const by = new Map(models.map((o) => [o.id, o]));
  const rival = row.beaten_by.length ? by.get(row.beaten_by[0]) : undefined;
  let note = rival ? `${rival.label} is ${edge(rival, m, d.objective)}` : '';
  if (!row.clears) return { kind: 'short', label: `${-row.margin} short`, note };
  const pick = d.pick === null ? undefined : by.get(d.pick);
  if (!note && pick) {
    const mine = metric(m, d.objective);
    const theirs = metric(pick, d.objective);
    if (mine === null) note = d.objective === 'cost' ? 'No price set' : 'Speed not measured';
    else if (theirs && mine / theirs >= 1.05)
      note = d.objective === 'cost' ? `${times(mine / theirs)} the price of the pick` : `Takes ${times(mine / theirs)} as long as the pick`;
  }
  return { kind: 'clears', label: 'Clears the bar', note };
}

const rating = (x: number) => Math.round(x).toLocaleString('en-US');

const list = (names: string[]) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * What blind judging says about the pick. Honest about overlap: two ratings whose ranges overlap
 * have not been told apart yet, whichever number is higher.
 */
export function judges(models: Pick<VerdictModel, 'id' | 'label'>[], human: Verdict['human'], pickId: number | null): Part[][] {
  const rated = models
    .map((m) => ({ ...m, h: human.models[String(m.id)] }))
    .filter((m) => m.h)
    .sort((a, b) => b.h.rating - a.h.rating);
  if (!human.count || rated.length < 2) return [['Nobody has judged these answers yet.']];
  const lo = (m: (typeof rated)[number]) => m.h.ci?.[0] ?? m.h.rating;
  const hi = (m: (typeof rated)[number]) => m.h.ci?.[1] ?? m.h.rating;
  const pick = rated.find((m) => m.id === pickId);
  const ratings = `${human.count.toLocaleString('en-US')} ${human.count === 1 ? 'rating' : 'ratings'}`;
  if (!pick) return [['Judges prefer ', { b: rated[0].label }, ` (${rating(rated[0].h.rating)}), on ${ratings}.`]];

  const above = rated.filter((m) => m.h.rating > pick.h.rating);
  if (!above.length) {
    const next = rated[1];
    if (lo(pick) > hi(next)) return [['Judges agree: they prefer ', { b: pick.label }, ' too, and clearly.']];
    return [['Judges lean the same way: ', { b: pick.label }, ` rates highest, though its range overlaps with ${next.label}'s.`]];
  }
  const clear = above.filter((m) => lo(m) > hi(pick));
  const lean = above.filter((m) => lo(m) <= hi(pick));
  const versus = (group: typeof rated) => (group.length === 1 ? ` (${rating(group[0].h.rating)} against ${rating(pick.h.rating)})` : '');
  const out: Part[][] = [];
  if (clear.length) out.push(['Judges clearly prefer ', { b: list(clear.map((m) => m.label)) }, ` to ${pick.label}${versus(clear)}.`]);
  if (lean.length) {
    const them = lean.length === 1 ? 'the two' : 'them';
    out.push([
      clear.length ? 'They also lean towards ' : 'Judges lean towards ',
      { b: list(lean.map((m) => m.label)) },
      `${clear.length ? '' : ` over ${pick.label}`}${versus(lean)}, but the ranges overlap: ${ratings} cannot separate ${them} yet.`,
    ]);
  }
  return out;
}

/** Whether the answer has held from run to run. `picks` is the pick of each run, oldest first. */
export function holding(picks: (number | null)[], current: number | null, name: (id: number) => string): string {
  const n = picks.length;
  if (!n) return '';
  if (n === 1) return 'One run so far. Run it again to see whether the answer holds.';
  const last = picks[n - 1];
  let streak = 1;
  while (streak < n && picks[n - 1 - streak] === last) streak++;
  const before = streak < n ? picks[n - 1 - streak] : undefined;
  let text: string;
  if (last === null) {
    text =
      streak === n
        ? `No model has cleared this bar in any of the ${n} runs.`
        : `No model cleared this bar in the last ${runs(streak)}. Before that the answer was ${name(before as number)}.`;
  } else if (streak === n) {
    text = `The answer has been ${name(last)} on all ${n} runs.`;
  } else {
    text = `The answer has been ${name(last)} for the last ${runs(streak)}. ${before === null ? 'Before that no model cleared the bar.' : `Before that it was ${name(before as number)}.`}`;
  }
  if (current !== last)
    text +=
      current === null
        ? " Counting each model's latest run, no model clears the bar today."
        : ` Counting each model's latest run, today's answer is ${name(current)}.`;
  return text;
}
