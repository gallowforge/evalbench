import { describe, expect, it } from 'vitest';
import type { Board, Model, Pair, RatingRow, RunDetail, RunListItem, TaskAnswers, Verdict } from '../api';
import { createBackend, type Fixtures, LIMITS } from './backend';
import fixtureData from './data/fixtures.json';
import snapshotData from './data/snapshots.json';

const fixtures = fixtureData as unknown as Fixtures;
const snapshots = snapshotData as unknown as { bodies: Record<string, unknown>; digests: Record<string, string> };
const CAPTURED = Date.parse(fixtures.captured_at);
const SUITE = 'core-battery';
const TRIAGE = 'support-triage';
const runsOf = (suite: string) => fixtures.runs.filter((r) => r.suite_id === suite).length;

/** The same written form scripts/capture-demo.mjs digests: objects with their keys sorted. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
async function sha(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}
const digest = (value: unknown) => sha(canonical(value));
const jsonl = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);

/** A backend on a clock the test moves by hand, frozen at the moment of the capture. */
function demo(options: { shift?: boolean; random?: () => number; at?: number } = {}) {
  const clock = { t: options.at ?? CAPTURED };
  const backend = createBackend(fixtures, { now: () => clock.t, shift: options.shift ?? false, random: options.random });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const reply = await backend.request(method, path, body);
    return { status: reply.status, data: reply.data as T, detail: (reply.data as { detail?: unknown })?.detail };
  };
  const get = async <T>(path: string) => {
    const reply = await call<T>('GET', path);
    expect(reply.status, path).toBe(200);
    return reply.data;
  };
  return { backend, clock, call, get, wait: (ms: number) => (clock.t += ms) };
}

describe('the demo answers what the server answered', () => {
  it('for every computed page', async () => {
    const { get } = demo();
    for (const [path, expected] of Object.entries(snapshots.bodies)) {
      const got = await get<Record<string, unknown>>(path);
      if (path.startsWith('/rate/next')) expect({ done: got.done, progress: got.progress }, path).toEqual(expected);
      else expect(got, path).toEqual(expected);
    }
    expect(Object.keys(snapshots.bodies).length).toBeGreaterThan(8);
  });

  it('for every run, task, rating and suite', async () => {
    const { get } = demo();
    let checked = 0;
    for (const [path, expected] of Object.entries(snapshots.digests)) {
      if (path.includes('/export/') || path.endsWith('/yaml')) continue;
      if (path.endsWith('/tasks/*')) {
        const run = await get<RunDetail>(path.replace('/tasks/*', ''));
        const answers: TaskAnswers[] = [];
        for (const task of run.tasks) answers.push(await get<TaskAnswers>(`${path.replace('*', '')}${encodeURIComponent(task.id)}`));
        expect(await digest(answers), path).toBe(expected);
      } else {
        expect(await digest(await get(path)), path).toBe(expected);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(fixtures.runs.length * 2 + 3);
  });

  it('for every download', async () => {
    const { backend } = demo();
    let checked = 0;
    for (const [path, expected] of Object.entries(snapshots.digests)) {
      if (!path.includes('/export/') && !path.endsWith('/yaml')) continue;
      const { text } = backend.file(path);
      // The spreadsheet and the suite file are compared to the byte, the JSON lines by what they say.
      expect(path.includes('.jsonl') ? await digest(jsonl(text)) : await sha(text), path).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it('names downloads as the server does', () => {
    const { backend } = demo();
    expect(backend.file(`/suites/${SUITE}/yaml`)).toMatchObject({ name: `${SUITE}.yaml`, type: 'application/yaml' });
    expect(backend.file('/export/ratings.csv').name).toBe('evalbench-ratings.csv');
    expect(backend.file(`/export/ratings.jsonl?suite=${SUITE}`).name).toBe(`evalbench-ratings-${SUITE}.jsonl`);
    expect(backend.file('/export/preferences.jsonl').name).toBe('evalbench-preferences.jsonl');
    expect(backend.file('/export/results.jsonl?run=6').name).toBe('evalbench-results-run6.jsonl');
    expect(() => backend.file('/export/everything.zip')).toThrow('The demo has no file at /export/everything.zip.');
  });
});

describe('routing', () => {
  it('answers an unknown path with a clear error instead of guessing', async () => {
    const { call } = demo();
    expect(await call('GET', '/nope')).toMatchObject({ status: 404, detail: 'The demo has no answer for GET /nope.' });
    expect(await call('PATCH', '/runs/1')).toMatchObject({ status: 404, detail: 'The demo has no answer for PATCH /runs/1.' });
    expect(await call('GET', '/runs/1/tasks')).toMatchObject({ status: 404 });
  });

  it('uses the server’s words for things that do not exist', async () => {
    const { call } = demo();
    expect(await call('GET', '/runs/999')).toMatchObject({ status: 404, detail: 'no such run' });
    expect(await call('GET', '/runs/1/tasks/none')).toMatchObject({ status: 404, detail: 'no such task in this run' });
    expect(await call('GET', '/suites/none')).toMatchObject({ status: 404, detail: 'no such suite' });
    expect(await call('PUT', '/models/999', {})).toMatchObject({ status: 404, detail: 'no such model' });
    expect(await call('GET', '/rate/next?rater=alex')).toMatchObject({ status: 422, detail: 'choose a run or a suite to rate' });
  });

  it('describes itself without a word about the machine that made the capture', async () => {
    const { get } = demo();
    const meta = await get<Record<string, unknown>>('/meta');
    expect(meta).toMatchObject({ demo: true, auth: false, authenticated: true, username: null, sandbox: { mode: 'demo', ok: true } });
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.stringify(fixtures)).not.toMatch(/\/(home|Users)\/|sk-[A-Za-z0-9]{16}|@(?!example\.)[\w-]+\.(com|dev|org)/);
  });

  it('needs no sign-in and has no account to set up', async () => {
    const { call } = demo();
    expect(await call('POST', '/auth/login', { username: 'a', password: 'b' })).toMatchObject({ status: 200, data: { ok: true } });
    expect(await call('POST', '/auth/logout')).toMatchObject({ status: 200, data: { ok: true } });
    expect(await call('POST', '/auth/setup', {})).toMatchObject({ status: 409, detail: LIMITS.account });
    expect(await call('POST', '/demo')).toMatchObject({ status: 200, data: { ok: true, already: true } });
  });

  it('moves the recorded dates forward by whole days, so they never look stale', async () => {
    const { get } = demo({ shift: true, at: CAPTURED + 9.5 * 86_400_000 });
    const runs = await get<RunListItem[]>('/runs');
    const recorded = fixtures.runs.find((r) => r.id === runs[0].id)!;
    expect(Date.parse(runs[0].created_at) - Date.parse(recorded.created_at)).toBe(9 * 86_400_000);
    expect(runs[0].created_at.slice(11)).toBe(recorded.created_at.slice(11));
  });
});

describe('writes stay in memory for the visit', () => {
  const rating = (pair: Pair, extra: Record<string, unknown> = {}) => ({
    result_a: pair.a.result_id,
    result_b: pair.b.result_id,
    run_id: null,
    preference: -2,
    scores: { a: { correctness: 5 }, b: { correctness: 2 } },
    flags: { a: [], b: ['incomplete', 'not-a-flag', 'incomplete'] },
    justification: 'A reaches the right answer and shows the step that B skips.',
    confidence: 'high',
    rater: '  sam  ',
    seconds: 40,
    ...extra,
  });

  it('keeps a rating: progress, the list, the board and the exports all move', async () => {
    const { call, get, backend } = demo();
    const before = await get<Board>(`/scoreboard/${SUITE}`);
    const pair = await get<Pair>(`/rate/next?suite=${SUITE}&rater=sam`);
    expect(pair).toMatchObject({ done: false, suite_id: SUITE, run_id: null, progress: { rated: 0 } });
    expect(pair.rubric.length).toBeGreaterThan(0);
    expect(pair.a.output).not.toBe(pair.b.output);

    const saved = await call<{ id: number }>('POST', '/ratings', rating(pair));
    expect(saved).toMatchObject({ status: 200, data: { id: fixtures.ratings.length + 1 } });

    const next = await get<Pair>(`/rate/next?suite=${SUITE}&rater=sam`);
    expect(next.progress).toEqual({ total: pair.progress.total, rated: 1, remaining: pair.progress.total - 1 });
    expect(next.key).not.toBe(pair.key);

    const [newest] = await get<RatingRow[]>('/ratings?limit=1');
    expect(newest).toMatchObject({ id: saved.data.id, rater: 'sam', preference: -2, preference_label: 'A is better', seconds: 40 });
    expect(newest.flags).toEqual({ a: [], b: ['incomplete'] });

    const after = await get<Board>(`/scoreboard/${SUITE}`);
    expect(after.ratings).toBe(before.ratings + 1);
    expect(after.models.map((m) => m.human?.rating)).not.toEqual(before.models.map((m) => m.human?.rating));
    expect(await get('/export/summary')).toMatchObject({ ratings: fixtures.ratings.length + 1 });
    expect(backend.file('/export/ratings.csv').text).toMatch(new RegExp(`\\n${saved.data.id},[^,]+,sam,${SUITE},`));
  });

  it('turns a bad rating down in the server’s words', async () => {
    const { call, get } = demo();
    const pair = await get<Pair>(`/rate/next?run=6&rater=sam`);
    expect(pair.run_id).toBe(6);
    const post = (extra: Record<string, unknown>) => call('POST', '/ratings', rating(pair, extra));
    expect(await post({ preference: 4 })).toMatchObject({
      status: 422,
      detail: 'preference must be between -3 (A much better) and 3 (B much better)',
    });
    expect(await post({ justification: 'short' })).toMatchObject({
      status: 422,
      detail: `write at least ${fixtures.meta.min_justification} characters explaining the choice`,
    });
    expect(await post({ result_b: undefined })).toMatchObject({ status: 422, detail: 'result_a, result_b and preference are required' });
    expect(await post({ result_b: 999_999 })).toMatchObject({ status: 422, detail: 'both answers must exist' });
    expect(await post({ scores: { a: { charm: 5 } } })).toMatchObject({ status: 422, detail: "unknown rubric dimension 'charm'" });
    expect(await post({ scores: { a: { correctness: 9 } } })).toMatchObject({ status: 422, detail: 'rubric scores run from 1 to 5' });
    expect(await post({ confidence: 'certain' })).toMatchObject({ status: 422, detail: 'confidence is low, medium or high' });
    expect((await post({})).status).toBe(200);
    expect(await post({})).toMatchObject({ status: 422, detail: 'you have already rated this pair' });
  });

  it('offers a skipped pair again only when nothing else is left', async () => {
    const { get } = demo({ random: () => 0.99 });
    const first = await get<Pair>(`/rate/next?suite=${SUITE}&rater=sam`);
    const second = await get<Pair>(`/rate/next?suite=${SUITE}&rater=sam&skip=${first.key}`);
    expect(second.key).not.toBe(first.key);
    expect(second.progress).toEqual(first.progress);
  });

  it('adds, edits, archives and deletes models', async () => {
    const { call, get } = demo();
    const made = await call<Model>('POST', '/models', {
      provider: 'openai-compatible',
      model: ' local-7b ',
      base_url: 'http://localhost:1234/v1/',
      params: { temperature: 9, max_tokens: 0 },
    });
    expect(made.data).toMatchObject({
      id: 6,
      label: 'local-7b',
      model: 'local-7b',
      base_url: 'http://localhost:1234/v1',
      concurrency: 1,
      archived: false,
      price_in: null,
      price_out: null,
    });
    expect(made.data.params).toEqual({ max_tokens: 1, temperature: 2 });
    expect(made.data.key).toEqual({ env: null, present: true });
    expect(fixtures.models.map((m) => m.color)).not.toContain(made.data.color);

    const edited = await call<Model>('PUT', '/models/6', { label: 'Local 7B', api_key_env: 'LOCAL_API_KEY' });
    expect(edited.data).toMatchObject({ id: 6, label: 'Local 7B', model: 'local-7b', key: { env: 'LOCAL_API_KEY', present: false } });
    expect((await get<Model[]>('/models')).map((m) => m.label)).toContain('Local 7B');

    expect(await call('POST', '/models', { provider: 'openai-compatible', model: 'x' })).toMatchObject({
      status: 422,
      detail: 'an OpenAI-compatible model needs a base URL',
    });
    expect(await call('POST', '/models', { provider: 'nobody', model: 'x' })).toMatchObject({ status: 422 });
    expect((await call<{ detail: string }>('PUT', '/models/6', { api_key_env: 'PATH' })).detail).toContain("'PATH' is not allowed as a key variable");
    expect((await call<{ detail: string }>('PUT', '/models/6', { api_key_env: 'OPENAI_API_KEY' })).detail).toContain(
      'OPENAI_API_KEY is only sent to api.openai.com',
    );

    // A price is dollars per million tokens: kept through other edits, cleared when emptied, zero is a price.
    const priced = await call<Model>('PUT', '/models/6', { price_in: '0.2', price_out: 0 });
    expect([priced.data.price_in, priced.data.price_out]).toEqual([0.2, 0]);
    expect((await call<Model>('PUT', '/models/6', { label: 'Local 7B' })).data.price_in).toBe(0.2);
    expect((await call<Model>('PUT', '/models/6', { price_in: '', price_out: null })).data).toMatchObject({ price_in: null, price_out: null });
    for (const bad of [-1, 'cheap', 100_001]) {
      expect(await call('PUT', '/models/6', { price_in: bad }), String(bad)).toMatchObject({
        status: 422,
        detail: 'a price is dollars per million tokens, zero or more',
      });
    }

    // No run has used the new model, so it goes; a model with history is kept and hidden.
    expect((await call('DELETE', '/models/6')).data).toEqual({ result: 'deleted' });
    expect((await call('DELETE', '/models/1')).data).toEqual({ result: 'archived' });
    expect((await get<Model[]>('/models')).map((m) => m.id)).toEqual([2, 3, 4, 5]);
    expect((await get<Model[]>('/models?archived=true')).map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    expect((await get<RunDetail>('/runs/6')).models.map((m) => m.id)).toContain(1);
  });

  it('renames a model everywhere at once, as the server does', async () => {
    const { call, get } = demo();
    await call('PUT', '/models/2', { label: 'Atlas 70B (tuned)' });
    expect((await get<RunDetail>('/runs/1')).models.find((m) => m.id === 2)!.label).toBe('Atlas 70B (tuned)');
    expect((await get<Board>(`/scoreboard/${SUITE}`)).models.find((m) => m.id === 2)!.label).toBe('Atlas 70B (tuned)');
  });

  it('says plainly what needs the server', async () => {
    const { call, get } = demo();
    expect(await call('POST', '/models/1/test')).toMatchObject({ status: 200, data: { ok: false, error: LIMITS.connection } });
    expect(await call('POST', '/models/discover', { provider: 'openai-compatible', base_url: 'http://x' })).toMatchObject({
      data: { ok: false, error: LIMITS.discover, models: [] },
    });
    expect(await call('POST', '/suites/validate', { yaml: 'id: x' })).toMatchObject({ status: 200, data: { ok: true } });
    expect(await call('PUT', `/suites/${SUITE}`, { yaml: 'id: x' })).toMatchObject({ status: 422, detail: { errors: [LIMITS.suites] } });
    expect(await call('POST', '/suites', { yaml: 'id: x' })).toMatchObject({ status: 422, detail: LIMITS.suites });
    expect(await call('DELETE', `/suites/${SUITE}`)).toMatchObject({ status: 422, detail: LIMITS.suites });
    expect((await get<{ yaml: string }>(`/suites/${SUITE}`)).yaml).toBe(fixtures.suites[0].yaml);
  });

  it('forgets everything on a reload', async () => {
    const first = demo();
    const pair = await first.get<Pair>(`/rate/next?suite=${SUITE}&rater=sam`);
    await first.call('POST', '/ratings', rating(pair));
    await first.call('POST', '/runs', { suite_id: SUITE, model_ids: [1] });
    await first.call('DELETE', '/models/1');
    const second = demo();
    expect(await second.get('/overview')).toEqual(snapshots.bodies['/overview']);
    expect(await second.get('/models')).toEqual(snapshots.bodies['/models']);
  });
});

describe('a new run replays the recorded answers', () => {
  const start = async (d: ReturnType<typeof demo>, model_ids: number[], label = 'replay') => {
    const made = await d.call<{ id: number }>('POST', '/runs', { suite_id: SUITE, model_ids, label });
    expect(made.status).toBe(200);
    return made.data.id;
  };

  it('queues, runs answer by answer and finishes with the recorded outcome', async () => {
    const d = demo();
    const id = await start(d, [1, 4], '  second look  ');
    expect(id).toBe(fixtures.runs.length + 1);

    let run = await d.get<RunDetail>(`/runs/${id}`);
    expect(run).toMatchObject({
      status: 'queued',
      active: true,
      label: 'second look',
      started_at: null,
      finished_at: null,
      progress: { total: 40, finished: 0 },
    });
    expect(run.results.every((r) => r.status === 'pending' && r.score === null)).toBe(true);
    expect((await d.get<RunListItem[]>('/runs'))[0]).toMatchObject({ id, active: true, status: 'queued' });

    const seen: number[] = [];
    let sawRunning = false;
    for (let step = 0; step < 400 && run.active; step++) {
      d.wait(250);
      run = await d.get<RunDetail>(`/runs/${id}`);
      seen.push(run.progress.finished);
      sawRunning ||= run.status === 'running' && run.results.some((r) => r.status === 'running');
    }
    expect(sawRunning).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBeGreaterThan(8);
    expect(run).toMatchObject({ status: 'done', active: false, progress: { total: 40, finished: 40 } });

    const took = Date.parse(run.finished_at!) - Date.parse(run.created_at);
    expect(took).toBeGreaterThanOrEqual(4000);
    expect(took).toBeLessThanOrEqual(26_000);

    // The same numbers as the last recorded run of the same two models.
    const recorded = await d.get<RunDetail>('/runs/6');
    for (const m of run.models) {
      const { total: _t, ...summary } = m.summary;
      expect(recorded.models.find((x) => x.id === m.id)!.summary).toMatchObject(summary);
    }
    const answers = await d.get<TaskAnswers>(`/runs/${id}/tasks/${run.tasks[0].id}`);
    const original = await d.get<TaskAnswers>(`/runs/6/tasks/${run.tasks[0].id}`);
    expect(answers.answers.map((a) => a.output)).toEqual(original.answers.filter((a) => [1, 4].includes(a.model_id)).map((a) => a.output));

    // It joins the history: the board's latest run for these models is now the new one.
    const board = await d.get<Board>(`/scoreboard/${SUITE}`);
    expect(board.runs).toBe(runsOf(SUITE) + 1);
    expect(board.models.find((m) => m.id === 1)!.auto!.run_id).toBe(id);
    expect(board.history.at(-1)).toMatchObject({ run_id: id, label: 'second look' });
    expect((await d.get<{ counts: { runs: number; answers: number } }>('/overview')).counts).toMatchObject({
      runs: fixtures.runs.length + 1,
      answers: fixtures.results.length + 40,
    });
  });

  it('stops when cancelled and picks up again when resumed', async () => {
    const d = demo();
    const id = await start(d, [2, 3]);
    d.wait(2500);
    const midway = await d.get<RunDetail>(`/runs/${id}`);
    expect(midway.status).toBe('running');
    expect(await d.call('POST', `/runs/${id}/resume`)).toMatchObject({ status: 409, detail: 'the run is still in progress' });
    expect(await d.call('DELETE', `/runs/${id}`)).toMatchObject({ status: 409 });

    expect((await d.call('POST', `/runs/${id}/cancel`)).data).toEqual({ ok: true });
    d.wait(30_000);
    const stopped = await d.get<RunDetail>(`/runs/${id}`);
    expect(stopped).toMatchObject({ status: 'cancelled', active: false });
    expect(stopped.progress.finished).toBeGreaterThanOrEqual(midway.progress.finished);
    expect(stopped.progress.finished).toBeLessThan(40);
    expect(stopped.results.some((r) => r.status === 'running')).toBe(false);

    expect((await d.call('POST', `/runs/${id}/resume`)).status).toBe(200);
    expect(await d.get<RunDetail>(`/runs/${id}`)).toMatchObject({ status: 'queued', active: true, finished_at: null });
    d.wait(60_000);
    expect(await d.get<RunDetail>(`/runs/${id}`)).toMatchObject({ status: 'done', active: false, progress: { finished: 40 } });

    expect((await d.call('DELETE', `/runs/${id}`)).data).toEqual({ ok: true });
    expect(await d.call('GET', `/runs/${id}`)).toMatchObject({ status: 404 });
    expect(await d.get('/runs')).toEqual(snapshots.bodies['/runs']);
  });

  it('checks the request the way the server does', async () => {
    const d = demo();
    expect(await d.call('POST', '/runs', { suite_id: 'none', model_ids: [1] })).toMatchObject({ status: 422, detail: "no suite 'none'" });
    expect(await d.call('POST', '/runs', { suite_id: SUITE, model_ids: [] })).toMatchObject({ status: 422, detail: 'choose at least one model' });
    expect(await d.call('POST', '/runs', { suite_id: SUITE, model_ids: [99] })).toMatchObject({ status: 422, detail: 'model 99 does not exist' });
  });

  it('moves the verdict: the new run is each model’s latest, and a new price changes the cost, not the marks', async () => {
    const d = demo();
    const before = await d.get<Verdict>(`/verdict/${TRIAGE}`);
    const label = (v: Verdict, id: number | null) => v.models.find((m) => m.id === id)?.label;
    expect(label(before, before.decision.pick)).toBe('Orion Mini');
    expect(before.picks.map((p) => label(before, p.pick))).toEqual(['Orion Mini', 'Orion Mini', 'Orion Mini']);
    const orion = before.models.find((m) => m.label === 'Orion Mini')!;
    const made = await d.call<{ id: number }>('POST', '/runs', { suite_id: TRIAGE, model_ids: [orion.id], label: 'again' });
    d.wait(600_000);
    const after = await d.get<Verdict>(`/verdict/${TRIAGE}`);
    expect(after.runs).toBe(runsOf(TRIAGE) + 1);
    expect(after.models.find((m) => m.id === orion.id)).toMatchObject({
      run_id: made.data.id,
      run_label: 'again',
      passed: orion.passed,
      cost: orion.cost,
    });
    expect(after.history.at(-1)!.models[orion.id]).toMatchObject({ passed: orion.passed, attempted: orion.attempted });
    await d.call('PUT', `/models/${orion.id}`, { price_in: orion.price_in! * 10, price_out: orion.price_out! * 10 });
    const dearer = (await d.get<Verdict>(`/verdict/${TRIAGE}`)).models.find((m) => m.id === orion.id)!;
    expect(dearer.cost).toBeCloseTo(orion.cost! * 10, 5);
    expect(dearer.passed).toBe(orion.passed);
    expect((await d.call('GET', '/verdict/nope')).status).toBe(404);
  });

  it('leaves a run that was cut short out of the verdict, and an archived model too', async () => {
    const d = demo();
    const before = await d.get<Verdict>(`/verdict/${TRIAGE}`);
    const orion = before.models.find((m) => m.label === 'Orion Mini')!;
    const made = await d.call<{ id: number }>('POST', '/runs', { suite_id: TRIAGE, model_ids: [orion.id], label: 'cut short' });
    d.wait(2500);
    await d.call('POST', `/runs/${made.data.id}/cancel`);
    d.wait(30_000);
    const stopped = await d.get<RunDetail>(`/runs/${made.data.id}`);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.progress.finished).toBeGreaterThan(0);
    expect(stopped.progress.finished).toBeLessThan(stopped.progress.total);
    // A few answers in is not a result: the model keeps the last run it finished.
    const during = await d.get<Verdict>(`/verdict/${TRIAGE}`);
    expect(during.runs).toBe(before.runs + 1);
    expect(during.models).toEqual(before.models);
    expect(during.history).toEqual(before.history);
    expect(during.picks).toEqual(before.picks);
    // A retired model is out of the running, and the answer moves on without it.
    expect((await d.call('DELETE', `/models/${orion.id}`)).data).toEqual({ result: 'archived' });
    const after = await d.get<Verdict>(`/verdict/${TRIAGE}`);
    expect(after.models.map((m) => m.id)).toEqual(before.models.map((m) => m.id).filter((id) => id !== orion.id));
    expect(after.models.find((m) => m.id === after.decision.pick)?.label).toBe('Nimbus Pro');
    expect(after.history.every((p) => !(orion.id in p.models))).toBe(true);
  });

  it('will not invent answers for a model it has never heard from', async () => {
    const d = demo();
    const made = await d.call<Model>('POST', '/models', { provider: 'anthropic', model: 'some-model', label: 'Newcomer' });
    expect(made.data.concurrency).toBe(4);
    expect(await d.call('POST', '/runs', { suite_id: SUITE, model_ids: [1, made.data.id] })).toMatchObject({
      status: 422,
      detail: LIMITS.recorded('Newcomer'),
    });
    expect((await d.get<RunListItem[]>('/runs')).length).toBe(fixtures.runs.length);
  });
});
