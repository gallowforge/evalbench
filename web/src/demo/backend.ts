/**
 * The demo's stand-in for the server. It starts from records captured from the app's own demo
 * workspace (scripts/capture-demo.mjs) and answers the same paths the real API does, computing
 * every page from those records the way the server does. Writes land in memory, so the pages
 * agree with each other for the length of a visit, and a reload starts over.
 *
 * Two things need a real server and are handled openly: a new run replays each model's recorded
 * answers on a clock, and anything that would have to reach a model or check a suite says so in
 * one sentence.
 */
import { version } from '../../package.json';
import type {
  Board,
  CheckResult,
  Model,
  ModelRef,
  NextPair,
  Overview,
  Provider,
  RatingRow,
  RubricDimension,
  RunDetail,
  RunListItem,
  RunStatus,
  Suite,
  SuitePayload,
  SuiteSummary,
  Summary,
  Task,
  TaskAnswers,
  Verdict,
  VerdictModel,
} from '../api';
import { SUITES_READ_ONLY } from '../lib/demo';
import { DEFAULT_BAR, decide, wilson } from '../lib/verdict';
import { bootstrap, bradleyTerry, type Game, pyRound, pySum, summarize } from './stats';

// ---------- records ----------

type SuiteRow = Omit<SuitePayload, 'runs'>;
type ModelRow = Model & { created_at: string };
type Snapshot = Pick<Model, 'id' | 'label' | 'provider' | 'base_url' | 'model' | 'api_key_env' | 'params' | 'concurrency' | 'color'>;

interface RunRow {
  id: number;
  suite_id: string;
  suite_title: string;
  label: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  models: Snapshot[];
}

interface ResultRow {
  id: number;
  run_id: number;
  task_id: string;
  task_hash: string;
  category: string;
  model_id: number;
  status: 'pending' | 'running' | 'done' | 'error';
  output: string | null;
  error: string | null;
  finish_reason: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  checks: CheckResult[];
  score: number | null;
  passed: number | null;
  completed_at: string | null;
}

type Outcome = Pick<
  ResultRow,
  'status' | 'output' | 'error' | 'finish_reason' | 'latency_ms' | 'input_tokens' | 'output_tokens' | 'checks' | 'score' | 'passed'
>;

type Sides<T> = { a?: T; b?: T };

interface RatingRecord {
  id: number;
  suite_id: string;
  run_id: number | null;
  task_id: string;
  result_a: number;
  result_b: number;
  model_a: number;
  model_b: number;
  preference: number;
  scores: Sides<Record<string, number>>;
  flags: Sides<string[]>;
  justification: string;
  confidence: string | null;
  rater: string;
  seconds: number | null;
  created_at: string;
}

interface MetaRecord {
  min_justification: number;
  providers: Record<Provider, { key_env: string | null }>;
  rating: { flags: { id: string }[]; scale: { value: number }[]; preference: { value: number; label: string }[] };
  [key: string]: unknown;
}

export interface Fixtures {
  captured_at: string;
  meta: MetaRecord;
  suites: SuiteRow[];
  models: ModelRow[];
  runs: RunRow[];
  results: ResultRow[];
  ratings: RatingRecord[];
}

export interface Reply {
  status: number;
  data: unknown;
}

export interface DemoFile {
  name: string;
  type: string;
  text: string;
}

export interface BackendOptions {
  /** The clock, in milliseconds. A replayed run is read off it, so nothing here sets a timer. */
  now?: () => number;
  random?: () => number;
  /** Move the recorded dates forward by whole days, so "2 days ago" stays true long after the capture. */
  shift?: boolean;
}

// ---------- what the demo cannot do, in one sentence each ----------

export const LIMITS = {
  suites: SUITES_READ_ONLY,
  connection: 'This demo runs in your browser and cannot reach a model. Connection tests need the real app.',
  discover: 'This demo runs in your browser and cannot ask an endpoint for its models.',
  recorded: (label: string) => `This demo replays recorded answers and has none for ${label}. Choose from the sample models.`,
  account: 'This demo has no accounts: there is nothing to sign in to.',
};

/** A refusal with the status and wording the server would use. */
class Refusal extends Error {
  status: number;
  detail: string | { errors: string[] };
  constructor(status: number, detail: string | { errors: string[] }) {
    super(typeof detail === 'string' ? detail : detail.errors[0]);
    this.status = status;
    this.detail = detail;
  }
}

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const KEY_NAME = /^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$/;
const OFFICIAL_KEYS: Record<string, string[]> = { ANTHROPIC_API_KEY: ['api.anthropic.com'], OPENAI_API_KEY: ['api.openai.com'] };
const SNAPSHOT_KEYS = ['id', 'label', 'provider', 'base_url', 'model', 'api_key_env', 'params', 'concurrency', 'color'] as const;
const OUTCOME_KEYS = [
  'status',
  'output',
  'error',
  'finish_reason',
  'latency_ms',
  'input_tokens',
  'output_tokens',
  'checks',
  'score',
  'passed',
] as const;

/** A replayed run: the wait in the queue, then each answer arriving when its recorded latency says. */
const QUEUE_MS = 700;
const REPLAY_SPEED = 0.4;
const DAY = 86_400_000;

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const safeName = (value: string | null) => (value ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
const blank = (v: unknown) => v === null || v === undefined || v === '';

/** `json.dumps(value, ensure_ascii=False)`: the spacing the server's JSONL files have. */
function pyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pyJson).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** One CSV field as Python's `csv.writer` writes it, after the formula guard in export.py. */
function csvCell(value: unknown): string {
  let text = blank(value) ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

interface Sim {
  queuedUntil: number;
  lastEnd: number;
  stopping: boolean;
  items: Map<number, { start: number; end: number }>;
}

type Scope = { run: number; suite?: undefined } | { suite: string; run?: undefined };

export function createBackend(fixtures: Fixtures, options: BackendOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const db = copy(fixtures);
  const meta = db.meta;

  const days = options.shift === false ? 0 : Math.max(0, Math.floor((now() - Date.parse(db.captured_at)) / DAY));
  if (days) {
    const later = (t: string | null) => (t ? iso(Date.parse(t) + days * DAY) : t);
    for (const m of db.models) m.created_at = later(m.created_at)!;
    for (const s of db.suites) s.updated_at = later(s.updated_at)!;
    for (const r of db.runs)
      Object.assign(r, { created_at: later(r.created_at), started_at: later(r.started_at), finished_at: later(r.finished_at) });
    for (const r of db.results) r.completed_at = later(r.completed_at);
    for (const r of db.ratings) r.created_at = later(r.created_at)!;
  }

  // The capture ran with these key variables set; a model that names another one shows as missing its key.
  const keysSet = new Set(db.models.filter((m) => m.key.env && m.key.present).map((m) => m.key.env));
  const sims = new Map<number, Sim>();
  const outcomes = new Map<number, Outcome>();
  let ratingsVersion = 0;

  // ---------- lookups ----------

  const suiteRow = (id: string) => db.suites.find((s) => s.id === id);
  const runRow = (id: number) => db.runs.find((r) => r.id === id);
  const resultsOf = (runId: number) => db.results.filter((r) => r.run_id === runId);
  const taskOf = (suite: Suite, id: string) => suite.tasks.find((t) => t.id === id);
  const systemFor = (suite: Suite, task: Task) => (task.system !== null && task.system !== undefined ? task.system : (suite.system ?? null));
  const rubricFor = (suite: Suite, task: Task): RubricDimension[] => (task.rubric?.length ? task.rubric : suite.rubric);
  const nextId = (rows: { id: number }[]) => rows.reduce((n, r) => Math.max(n, r.id), 0) + 1;

  /** Every recorded run answered the suite as it is now (the capture checks), so a run reads its tasks from there. */
  function suiteFor(run: RunRow): Suite {
    const row = suiteRow(run.suite_id);
    if (!row) throw new Refusal(404, 'no such suite');
    return row.suite;
  }

  const unscoredOf = (suite: Suite) => new Set(suite.tasks.filter((t) => !t.checks.length).map((t) => t.id));

  function categoriesOf(suite: Suite): string[] {
    return [...new Set(suite.tasks.map((t) => t.category))];
  }

  function keyStatus(model: { provider: Provider; api_key_env: string | null }) {
    const env = model.api_key_env || meta.providers[model.provider]?.key_env || null;
    return env ? { env, present: keysSet.has(env) } : { env: null, present: true };
  }

  /** A run shows a model under today's name and colour; its settings stay as they were. */
  function runModels(run: RunRow): Snapshot[] {
    return run.models.map((snap) => {
      const current = db.models.find((m) => m.id === snap.id);
      return current ? { ...snap, label: current.label, color: current.color || snap.color } : { ...snap };
    });
  }

  // ---------- replayed runs ----------

  /** Bring every replayed run up to the clock. Called before each request, so reading is what moves a run along. */
  function settle(): void {
    const t = now();
    for (const [runId, sim] of sims) {
      const run = runRow(runId);
      if (!run) {
        sims.delete(runId);
        continue;
      }
      if (run.status === 'queued' && t >= sim.queuedUntil) {
        run.status = 'running';
        run.started_at ??= iso(sim.queuedUntil);
      }
      for (const [id, item] of sim.items) {
        const row = db.results.find((r) => r.id === id);
        if (!row) {
          sim.items.delete(id);
        } else if (t >= item.end) {
          Object.assign(row, outcomes.get(id) ?? { status: 'error', error: 'The demo has no recorded answer for this task.' });
          row.completed_at = iso(item.end);
          sim.lastEnd = Math.max(sim.lastEnd, item.end);
          sim.items.delete(id);
          outcomes.delete(id);
        } else if (t >= item.start) {
          row.status = 'running';
        }
      }
      if (!sim.items.size && run.status === 'running') {
        const rows = resultsOf(runId);
        const failed = rows.some((r) => r.status === 'error') && !rows.some((r) => r.status === 'done');
        run.status = sim.stopping ? 'cancelled' : failed ? 'failed' : 'done';
        run.finished_at = iso(sim.lastEnd);
        sims.delete(runId);
      }
    }
  }

  /** Lay the waiting answers out in time: each model works through its tasks in as many lanes as its concurrency. */
  function schedule(run: RunRow, rows: ResultRow[]): void {
    const t = now();
    const lanes = new Map<number, number[]>();
    const plan = rows.map((row) => {
      const model = run.models.find((m) => m.id === row.model_id);
      const free = lanes.get(row.model_id) ?? new Array<number>(Math.max(1, model?.concurrency ?? 1)).fill(0);
      lanes.set(row.model_id, free);
      const lane = free.indexOf(Math.min(...free));
      const start = free[lane];
      free[lane] = start + (outcomes.get(row.id)?.latency_ms ?? 1200);
      return { id: row.id, start, end: free[lane] };
    });
    const total = Math.max(1, ...plan.map((p) => p.end));
    // About two and a half times real speed, but never a blink and never a long wait.
    const speed = Math.min(1.5, Math.max(REPLAY_SPEED, 4000 / total), 24_000 / total);
    const queuedUntil = t + QUEUE_MS;
    sims.set(run.id, {
      queuedUntil,
      lastEnd: queuedUntil,
      stopping: false,
      items: new Map(plan.map((p) => [p.id, { start: queuedUntil + p.start * speed, end: queuedUntil + p.end * speed }])),
    });
  }

  function createRun(body: Record<string, unknown>): { id: number } {
    const suite = suiteRow(String(body.suite_id ?? ''));
    if (!suite) throw new Refusal(422, `no suite '${String(body.suite_id ?? '')}'`);
    const ids = [...new Set((Array.isArray(body.model_ids) ? body.model_ids : []).map(Number))];
    if (!ids.length) throw new Refusal(422, 'choose at least one model');
    const models = ids.map((id) => {
      const m = db.models.find((x) => x.id === id);
      if (!m || m.archived) throw new Refusal(422, `model ${id} does not exist`);
      return m;
    });
    // The newest finished answer of each model to each task is what the new run will receive.
    const recorded = new Map<string, ResultRow>();
    const suiteRuns = new Set(db.runs.filter((r) => r.suite_id === suite.id).map((r) => r.id));
    for (const r of db.results) {
      if (suiteRuns.has(r.run_id) && (r.status === 'done' || r.status === 'error') && suite.hashes[r.task_id] === r.task_hash) {
        recorded.set(`${r.task_id}|${r.model_id}`, r);
      }
    }
    for (const m of models) {
      if (suite.suite.tasks.some((t) => !recorded.has(`${t.id}|${m.id}`))) throw new Refusal(422, LIMITS.recorded(m.label));
    }
    const run: RunRow = {
      id: nextId(db.runs),
      suite_id: suite.id,
      suite_title: suite.title,
      label: String(body.label ?? '')
        .trim()
        .slice(0, 80),
      status: 'queued',
      created_at: iso(now()),
      started_at: null,
      finished_at: null,
      models: models.map((m) => copy(Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, m[k]])) as Snapshot)),
    };
    db.runs.push(run);
    let id = nextId(db.results);
    const rows: ResultRow[] = [];
    for (const task of suite.suite.tasks) {
      for (const m of models) {
        const source = recorded.get(`${task.id}|${m.id}`)!;
        outcomes.set(id, copy(Object.fromEntries(OUTCOME_KEYS.map((k) => [k, source[k]])) as Outcome));
        rows.push({
          id: id++,
          run_id: run.id,
          task_id: task.id,
          task_hash: suite.hashes[task.id],
          category: task.category,
          model_id: m.id,
          status: 'pending',
          output: null,
          error: null,
          finish_reason: null,
          latency_ms: null,
          input_tokens: null,
          output_tokens: null,
          checks: [],
          score: null,
          passed: null,
          completed_at: null,
        });
      }
    }
    db.results.push(...rows);
    schedule(run, rows);
    return { id: run.id };
  }

  /** Answers already on their way still arrive; the rest stay unasked, as on the server. */
  function cancelRun(runId: number): { ok: true } {
    const sim = sims.get(runId);
    const run = runRow(runId);
    if (!sim || !run) return { ok: true };
    const t = now();
    sim.stopping = true;
    for (const [id, item] of sim.items) if (item.start > t) sim.items.delete(id);
    if (run.status === 'queued') {
      run.status = 'running';
      run.started_at ??= iso(t);
    }
    sim.lastEnd = Math.max(sim.lastEnd, t);
    settle();
    return { ok: true };
  }

  function resumeRun(runId: number): { ok: true } {
    const run = runRow(runId);
    if (!run) throw new Refusal(404, 'no such run');
    if (sims.has(runId)) throw new Refusal(409, 'the run is still in progress');
    const rows = resultsOf(runId);
    for (const row of rows) {
      if (row.status !== 'error' && row.status !== 'running') continue;
      // Asked again, a failed answer fails the same way: the demo only has what was recorded.
      if (!outcomes.has(row.id)) outcomes.set(row.id, copy(Object.fromEntries(OUTCOME_KEYS.map((k) => [k, row[k]])) as Outcome));
      row.status = 'pending';
      row.error = null;
    }
    run.status = 'queued';
    run.finished_at = null;
    schedule(
      run,
      rows.filter((r) => r.status === 'pending'),
    );
    return { ok: true };
  }

  function deleteRun(runId: number): { ok: true } {
    if (sims.has(runId)) throw new Refusal(409, 'cancel the run first');
    const gone = new Set(resultsOf(runId).map((r) => r.id));
    db.ratings = db.ratings.filter((g) => !gone.has(g.result_a) && !gone.has(g.result_b));
    db.results = db.results.filter((r) => r.run_id !== runId);
    db.runs = db.runs.filter((r) => r.id !== runId);
    ratingsVersion++;
    return { ok: true };
  }

  // ---------- runs, as the pages read them ----------

  const BRIEF = ['pass_rate', 'mean_score', 'errors', 'latency_ms', 'scored', 'attempted', 'passed'] as const;

  function runList(suiteId: string | null, limit = 100): Omit<RunListItem, 'active'>[] {
    return db.runs
      .filter((r) => !suiteId || r.suite_id === suiteId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((run) => {
        const results = resultsOf(run.id);
        const unscored = unscoredOf(suiteFor(run));
        const { models: _snapshots, ...fields } = run;
        return {
          ...fields,
          models: runModels(run).map((m) => {
            const s = summarize(
              results.filter((r) => r.model_id === m.id),
              unscored,
            );
            return {
              id: m.id,
              label: m.label,
              color: m.color,
              ...(Object.fromEntries(BRIEF.map((k) => [k, s[k]])) as Pick<Summary, (typeof BRIEF)[number]>),
            };
          }),
          progress: { total: results.length, finished: results.filter((r) => r.status === 'done' || r.status === 'error').length },
          tasks: new Set(results.map((r) => r.task_id)).size,
        };
      });
  }

  function runDetail(runId: number): RunDetail {
    const run = runRow(runId);
    if (!run) throw new Refusal(404, 'no such run');
    const suite = suiteFor(run);
    const unscored = unscoredOf(suite);
    const results = resultsOf(runId);
    const { models: _snapshots, ...fields } = run;
    return {
      ...fields,
      tasks: suite.tasks.map((t) => ({ id: t.id, title: t.title || t.id, category: t.category, checks: t.checks.length })),
      categories: categoriesOf(suite),
      models: runModels(run).map((m) => ({
        ...m,
        summary: summarize(
          results.filter((r) => r.model_id === m.id),
          unscored,
        ),
      })),
      results: results.map(({ output: _output, completed_at: _completed, ...row }) => row),
      progress: { total: results.length, finished: results.filter((r) => r.status === 'done' || r.status === 'error').length },
      rating: progress('', { run: runId }),
      active: sims.has(runId),
    };
  }

  function taskAnswers(runId: number, taskId: string): TaskAnswers {
    const run = runRow(runId);
    const suite = run && suiteFor(run);
    const task = suite && taskOf(suite, taskId);
    if (!suite || !task) throw new Refusal(404, 'no such task in this run');
    const { rubric: _rubric, ...rest } = task;
    return {
      task: { ...rest, system: systemFor(suite, task) },
      answers: resultsOf(runId)
        .filter((r) => r.task_id === taskId)
        .sort((a, b) => a.model_id - b.model_id),
    };
  }

  // ---------- blind rating ----------

  /** Answers open for rating: one run's, or each model's most recent answer to each task of a suite. */
  function scopeResults(scope: Scope): ResultRow[] {
    const answered = (r: ResultRow) => r.status === 'done' && !!r.output;
    if (scope.run !== undefined) return resultsOf(scope.run).filter(answered);
    const runs = new Set(db.runs.filter((r) => r.suite_id === scope.suite).map((r) => r.id));
    const latest = new Map<string, number>();
    for (const r of db.results) {
      if (!runs.has(r.run_id) || r.status !== 'done') continue;
      const key = `${r.task_id}|${r.model_id}`;
      latest.set(key, Math.max(latest.get(key) ?? 0, r.run_id));
    }
    return db.results.filter((r) => runs.has(r.run_id) && answered(r) && latest.get(`${r.task_id}|${r.model_id}`) === r.run_id);
  }

  /** Two answers to the same version of a task, from different models, that are not word for word the same. */
  function candidatePairs(results: ResultRow[]): [ResultRow, ResultRow][] {
    const byTask = new Map<string, ResultRow[]>();
    for (const r of results) byTask.set(r.task_id, [...(byTask.get(r.task_id) ?? []), r]);
    const pairs: [ResultRow, ResultRow][] = [];
    for (const taskId of [...byTask.keys()].sort()) {
      const rows = byTask.get(taskId)!.sort((a, b) => a.model_id - b.model_id);
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const [x, y] = [rows[i], rows[j]];
          if (x.model_id !== y.model_id && x.task_hash === y.task_hash && (x.output ?? '').trim() !== (y.output ?? '').trim()) pairs.push([x, y]);
        }
      }
    }
    return pairs;
  }

  const ratedBy = (rater: string) => new Set(db.ratings.filter((g) => g.rater === rater).map((g) => pairKey(g.result_a, g.result_b)));

  function progress(rater: string, scope: Scope) {
    const pairs = candidatePairs(scopeResults(scope));
    const done = ratedBy(rater);
    const rated = pairs.filter(([x, y]) => done.has(pairKey(x.id, y.id))).length;
    return { total: pairs.length, rated, remaining: pairs.length - rated };
  }

  /** The least-rated open pair, sides shuffled. Skipped pairs come back only once nothing else is left. */
  function nextPair(rater: string, scope: Scope, skip: string[]): NextPair {
    const pairs = candidatePairs(scopeResults(scope));
    const done = ratedBy(rater);
    const open = pairs.filter(([x, y]) => !done.has(pairKey(x.id, y.id)));
    if (!open.length) return { done: true, progress: progress(rater, scope) };
    const skipped = new Set(skip);
    const fresh = open.filter(([x, y]) => !skipped.has(pairKey(x.id, y.id)));
    const choices = fresh.length ? fresh : open;
    const pairCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    for (const g of db.ratings) {
      pairCounts.set(pairKey(g.result_a, g.result_b), (pairCounts.get(pairKey(g.result_a, g.result_b)) ?? 0) + 1);
      modelCounts.set(pairKey(g.model_a, g.model_b), (modelCounts.get(pairKey(g.model_a, g.model_b)) ?? 0) + 1);
    }
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    const weight = ([p, q]: [ResultRow, ResultRow]) => [
      pairCounts.get(pairKey(p.id, q.id)) ?? 0,
      modelCounts.get(pairKey(p.model_id, q.model_id)) ?? 0,
    ];
    let [x, y] = choices.reduce((best, pair) => {
      const [a, b] = [weight(pair), weight(best)];
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? pair : best;
    });
    if (random() < 0.5) [x, y] = [y, x];
    const run = runRow(x.run_id)!;
    const suite = suiteFor(run);
    const task = taskOf(suite, x.task_id);
    if (!task) return { done: true, progress: progress(rater, scope) };
    return {
      done: false,
      suite_id: run.suite_id,
      run_id: scope.run ?? null,
      task: {
        id: task.id,
        title: task.title || task.id,
        category: task.category,
        prompt: task.prompt,
        system: systemFor(suite, task),
        reference: task.reference ?? null,
        notes: task.notes ?? null,
      },
      rubric: rubricFor(suite, task),
      key: pairKey(x.id, y.id),
      a: { result_id: x.id, output: x.output! },
      b: { result_id: y.id, output: y.output! },
      progress: { total: pairs.length, rated: pairs.length - open.length, remaining: open.length },
    };
  }

  function saveRating(payload: Record<string, unknown>): { id: number } {
    const refuse = (message: string): never => {
      throw new Refusal(422, message);
    };
    const whole = (v: unknown) => (blank(v) || !Number.isFinite(Number(v)) ? NaN : Math.trunc(Number(v)));
    const [aId, bId, preference] = [whole(payload.result_a), whole(payload.result_b), whole(payload.preference)];
    if ([aId, bId, preference].some(Number.isNaN)) refuse('result_a, result_b and preference are required');
    if (!meta.rating.preference.some((p) => p.value === preference)) refuse('preference must be between -3 (A much better) and 3 (B much better)');
    const justification = String(payload.justification ?? '').trim();
    if (justification.length < meta.min_justification) refuse(`write at least ${meta.min_justification} characters explaining the choice`);
    const a = db.results.find((r) => r.id === aId);
    const b = db.results.find((r) => r.id === bId);
    if (!a || !b || a === b) return refuse('both answers must exist');
    const [runA, runB] = [runRow(a.run_id)!, runRow(b.run_id)!];
    if (a.task_id !== b.task_id || runA.suite_id !== runB.suite_id || a.task_hash !== b.task_hash)
      refuse('both answers must be to the same version of the same task');
    if (a.model_id === b.model_id) refuse('compare answers from two different models');
    if ([a, b].some((r) => r.status !== 'done' || !(r.output ?? '').trim())) refuse('both answers must be finished');
    const rater = String(payload.rater ?? '')
      .trim()
      .slice(0, 40);
    if (db.ratings.some((g) => g.rater === rater && pairKey(g.result_a, g.result_b) === pairKey(aId, bId)))
      refuse('you have already rated this pair');
    const suite = suiteFor(runA);
    const task = taskOf(suite, a.task_id);
    const dims = new Set(task ? rubricFor(suite, task).map((d) => d.id) : []);
    const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    const rawScores = payload.scores ?? {};
    const rawFlags = payload.flags ?? {};
    if (!isObject(rawScores) || !isObject(rawFlags)) return refuse('scores and flags are objects keyed by side, a and b');
    const scores: { a: Record<string, number>; b: Record<string, number> } = { a: {}, b: {} };
    const flags: { a: string[]; b: string[] } = { a: [], b: [] };
    const flagIds = new Set(meta.rating.flags.map((f) => f.id));
    for (const side of ['a', 'b'] as const) {
      const sideScores = rawScores[side] ?? {};
      if (!isObject(sideScores)) return refuse('scores for each side map rubric dimensions to 1-5');
      for (const [dim, value] of Object.entries(sideScores)) {
        if (!dims.has(dim)) refuse(`unknown rubric dimension '${dim}'`);
        if (!meta.rating.scale.some((s) => s.value === whole(value))) refuse('rubric scores run from 1 to 5');
        scores[side][dim] = whole(value);
      }
      const sideFlags = rawFlags[side] ?? [];
      if (!Array.isArray(sideFlags)) return refuse('flags for each side are a list');
      flags[side] = [...new Set(sideFlags.filter((f): f is string => flagIds.has(f)))].sort();
    }
    const confidence = payload.confidence;
    if (!blank(confidence) && !['low', 'medium', 'high'].includes(confidence as string)) refuse('confidence is low, medium or high');
    const seconds = blank(payload.seconds) ? null : whole(payload.seconds);
    const runId = blank(payload.run_id) ? null : whole(payload.run_id);
    if (Number.isNaN(seconds) || Number.isNaN(runId)) refuse('seconds and run_id are numbers');
    const id = nextId(db.ratings);
    db.ratings.push({
      id,
      suite_id: runA.suite_id,
      run_id: runId,
      task_id: a.task_id,
      result_a: aId,
      result_b: bId,
      model_a: a.model_id,
      model_b: b.model_id,
      preference,
      scores,
      flags,
      justification,
      confidence: blank(confidence) ? null : (confidence as string),
      rater,
      seconds: seconds === null ? null : Math.max(0, Math.min(seconds, 86_400)),
      created_at: iso(now()),
    });
    ratingsVersion++;
    return { id };
  }

  const preferenceLabel = (p: number) => meta.rating.preference.find((x) => x.value === p)?.label ?? '';

  function ratingRows(suiteId: string | null, limit: number): RatingRow[] {
    const rows = db.ratings.filter((g) => !suiteId || g.suite_id === suiteId).sort((a, b) => b.id - a.id);
    return (limit ? rows.slice(0, limit) : rows).map((g) => ({ ...g, preference_label: preferenceLabel(g.preference) }));
  }

  // ---------- the human leaderboard ----------

  type Human = NonNullable<Board['models'][number]['human']>;
  const boards = new Map<string, { version: number; board: { models: Map<number, Human>; h2h: Board['h2h']; count: number } }>();

  function humanBoard(suiteId: string) {
    const kept = boards.get(suiteId);
    if (kept?.version === ratingsVersion) return kept.board;
    const games: Game[] = db.ratings
      .filter((g) => g.suite_id === suiteId)
      .map((g) => [g.model_a, g.model_b, g.preference < 0 ? 1 : g.preference > 0 ? 0 : 0.5]);
    const ratings = bradleyTerry(games);
    const ci = bootstrap(games);
    const record = new Map<number, { wins: number; games: number; ties: number }>();
    const h2h: Board['h2h'] = {};
    for (const [a, b, s] of games) {
      for (const [p, score] of [
        [a, s],
        [b, 1 - s],
      ]) {
        const rec = record.get(p) ?? { wins: 0, games: 0, ties: 0 };
        record.set(p, { wins: rec.wins + score, games: rec.games + 1, ties: rec.ties + (s === 0.5 ? 1 : 0) });
      }
      const cell = (h2h[pairKey(a, b)] ??= { wins: 0, games: 0 });
      cell.wins += a < b ? s : 1 - s; // wins of the lower id
      cell.games += 1;
    }
    const models = new Map<number, Human>();
    for (const [p, r] of ratings) {
      const rec = record.get(p)!;
      const interval = ci.get(p);
      models.set(p, {
        rating: pyRound(r, 1),
        ci: interval ? [pyRound(interval[0], 1), pyRound(interval[1], 1)] : null,
        win_rate: rec.games ? pyRound(rec.wins / rec.games, 4) : null,
        games: rec.games,
        ties: rec.ties,
      });
    }
    const board = { models, h2h, count: games.length };
    boards.set(suiteId, { version: ratingsVersion, board });
    return board;
  }

  // ---------- scoreboard and overview ----------

  function scoreboard(suiteId: string): Board {
    const runs = db.runs.filter((r) => r.suite_id === suiteId).sort((a, b) => a.id - b.id);
    const runIds = runs.map((r) => r.id);
    const unscored = new Map(runs.map((r) => [r.id, unscoredOf(suiteFor(r))]));
    const modelsSeen = new Map<number, ModelRef>();
    for (const run of runs) {
      for (const m of runModels(run)) modelsSeen.set(m.id, { id: m.id, label: m.label, color: m.color, provider: m.provider, model: m.model });
    }
    const byRunModel = new Map<string, ResultRow[]>();
    for (const r of db.results) {
      if (!unscored.has(r.run_id)) continue;
      const key = `${r.run_id}:${r.model_id}`;
      byRunModel.set(key, [...(byRunModel.get(key) ?? []), r]);
    }
    const rowsOf = (runId: number, modelId: number) => byRunModel.get(`${runId}:${modelId}`) ?? [];

    const history: Board['history'] = [];
    for (const run of runs) {
      const models: Board['history'][number]['models'] = {};
      for (const [key, rows] of byRunModel) {
        const [rid, mid] = key.split(':').map(Number);
        if (rid !== run.id) continue;
        const s = summarize(rows, unscored.get(rid)!);
        if (s.pass_rate !== null) models[mid] = { pass_rate: s.pass_rate, mean_score: s.mean_score! };
      }
      if (Object.keys(models).length) history.push({ run_id: run.id, label: run.label, created_at: run.created_at, models });
    }

    const latest = new Map<number, Summary & { run_id: number }>();
    const regressions: Board['regressions'] = [];
    for (const mid of modelsSeen.keys()) {
      const modelRuns = runIds.filter((rid) => rowsOf(rid, mid).some((r) => r.status === 'done' || r.status === 'error'));
      if (!modelRuns.length) continue;
      const last = modelRuns[modelRuns.length - 1];
      const rows = rowsOf(last, mid);
      latest.set(mid, { run_id: last, ...summarize(rows, unscored.get(last)!) });
      if (modelRuns.length < 2) continue;
      const prev = modelRuns[modelRuns.length - 2];
      const before = new Map(
        rowsOf(prev, mid)
          .filter((r) => r.passed !== null)
          .map((r) => [r.task_id, r]),
      );
      const changes: Board['regressions'][number]['changes'] = [];
      for (const nowRow of rows) {
        if (nowRow.passed === null && nowRow.status !== 'error') continue;
        const was = before.get(nowRow.task_id);
        if (!was) continue;
        let kind: Board['regressions'][number]['changes'][number]['kind'] | null;
        if (nowRow.status === 'error') kind = was.passed ? 'errored' : null;
        else if (was.passed === nowRow.passed) kind = null;
        else if (was.task_hash !== nowRow.task_hash) kind = 'task_changed';
        else kind = was.passed ? 'regression' : 'fixed';
        if (kind) changes.push({ task_id: nowRow.task_id, category: nowRow.category, kind, result_id: nowRow.id });
      }
      const first = (c: { kind: string }) => (c.kind === 'regression' ? 0 : 1);
      regressions.push({
        model_id: mid,
        from_run: prev,
        to_run: last,
        regressed: changes.filter((c) => c.kind === 'regression').length,
        fixed: changes.filter((c) => c.kind === 'fixed').length,
        changes: changes.sort((a, b) => first(a) - first(b) || (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0)),
      });
    }

    const human = humanBoard(suiteId);
    const suite = runs.length ? suiteFor(runs[runs.length - 1]) : null;
    const rows: Board['models'] = [];
    for (const [mid, m] of modelsSeen) {
      if (!latest.has(mid) && !human.models.has(mid)) continue;
      rows.push({ ...m, auto: latest.get(mid) ?? null, human: human.models.get(mid) ?? null });
    }
    rows.sort(
      (a, b) =>
        (b.auto?.pass_rate ?? 0) - (a.auto?.pass_rate ?? 0) ||
        (b.human?.rating ?? 0) - (a.human?.rating ?? 0) ||
        (b.auto?.mean_score ?? 0) - (a.auto?.mean_score ?? 0),
    );
    return {
      suite_id: suiteId,
      models: rows,
      categories: suite ? categoriesOf(suite) : [],
      task_titles: suite ? Object.fromEntries(suite.tasks.map((t) => [t.id, t.title || t.id])) : {},
      history,
      regressions,
      h2h: human.h2h,
      ratings: human.count,
      runs: runs.length,
    };
  }

  const byTitle = <T extends { title: string }>(rows: T[]) => [...rows].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  function overview(): Overview {
    const suites = byTitle(db.suites);
    const done = db.results.filter((r) => r.status === 'done');
    return {
      counts: {
        suites: suites.length,
        models: db.models.filter((m) => !m.archived).length,
        runs: db.runs.length,
        answers: done.length,
        ratings: db.ratings.length,
        checks_run: done.reduce((n, r) => n + r.checks.length, 0),
      },
      boards: suites.filter((s) => db.runs.some((r) => r.suite_id === s.id)).map((s) => ({ id: s.id, title: s.title, ...scoreboard(s.id) })),
      recent_runs: runList(null, 6) as RunListItem[],
      rating: suites.map((s) => ({ suite_id: s.id, title: s.title, ...progress('', { suite: s.id }) })).filter((p) => p.total),
      demo: true,
    };
  }

  // ---------- the verdict ----------

  type Measured = Omit<
    VerdictModel,
    'id' | 'label' | 'color' | 'provider' | 'model' | 'price_in' | 'price_out' | 'archived' | 'run_id' | 'run_label' | 'run_at'
  >;

  /** Dollars for 1,000 answers at these prices, from the tokens the run used (`cost_per_1k` in verdict.py). */
  function costPer1k(rows: ResultRow[], priceIn: number | null | undefined, priceOut: number | null | undefined): number | null {
    if (priceIn === null || priceIn === undefined || priceOut === null || priceOut === undefined) return null;
    const used = rows.filter((r) => r.status === 'done' && r.input_tokens !== null && r.output_tokens !== null);
    if (!used.length) return null;
    return pyRound(pySum(used.map((r) => r.input_tokens! * priceIn + r.output_tokens! * priceOut)) / used.length / 1000, 6);
  }

  const mean = (values: number[]) => (values.length ? pyRound(pySum(values) / values.length, 1) : null);

  /** One line on why an answer did not pass: the first check it failed, or the error. */
  function why(row: ResultRow): string {
    if (row.status === 'error') return row.error || 'no answer';
    const failed = row.checks.find((c) => !c.passed);
    return failed ? failed.label || failed.type || 'a check failed' : '';
  }

  function candidate(
    rows: ResultRow[],
    unscored: ReadonlySet<string>,
    prices: { price_in?: number | null; price_out?: number | null },
  ): Measured | null {
    // A model counts in a run once it has answered everything it was given (`_candidate` in verdict.py).
    if (rows.some((r) => r.status === 'pending' || r.status === 'running')) return null;
    const s = summarize(rows, unscored);
    if (!s.attempted) return null;
    const done = rows.filter((r) => r.status === 'done');
    const categories: Record<string, [number, number]> = {};
    const tasks: VerdictModel['tasks'] = {};
    for (const r of rows) {
      if (unscored.has(r.task_id) || (r.status !== 'done' && r.status !== 'error')) continue;
      if (r.status === 'done' && r.passed === null) continue;
      const ok = r.status === 'done' && Boolean(r.passed);
      const cell = (categories[r.category] ??= [0, 0]);
      cell[0] += Number(ok);
      cell[1] += 1;
      tasks[r.task_id] = ok ? { ok, result_id: r.id } : { ok, result_id: r.id, why: why(r) };
    }
    const tokens = (key: 'input_tokens' | 'output_tokens') => mean(done.filter((r) => r[key] !== null).map((r) => r[key] as number));
    return {
      passed: s.passed,
      attempted: s.attempted,
      pass_rate: s.pass_rate!,
      interval: wilson(s.passed, s.attempted),
      errors: s.errors,
      latency_ms: s.latency_ms,
      input_tokens: tokens('input_tokens'),
      output_tokens: tokens('output_tokens'),
      cost: costPer1k(rows, prices.price_in, prices.price_out),
      categories,
      tasks,
    };
  }

  /** Everything the verdict page shows for one suite (`verdict` in verdict.py). */
  function verdict(suiteId: string): Verdict {
    const stored = suiteRow(suiteId);
    if (!stored) throw new Refusal(404, 'no such suite');
    const suite = stored.suite;
    const runs = db.runs.filter((r) => r.suite_id === suiteId).sort((a, b) => a.id - b.id);
    const bar = suite.bar ?? DEFAULT_BAR;
    const unscored = unscoredOf(suite);

    const runIds = new Set(runs.map((r) => r.id));
    const byRunModel = new Map<string, ResultRow[]>();
    for (const r of [...db.results].sort((a, b) => a.id - b.id)) {
      if (!runIds.has(r.run_id)) continue;
      const key = `${r.run_id}:${r.model_id}`;
      byRunModel.set(key, [...(byRunModel.get(key) ?? []), r]);
    }

    type Info = Pick<VerdictModel, 'label' | 'color' | 'provider' | 'model'> & {
      price_in?: number | null;
      price_out?: number | null;
      archived?: boolean;
    };
    const info = new Map<number, Info>();
    for (const run of runs) {
      for (const snap of run.models) info.set(snap.id, { label: snap.label, color: snap.color, provider: snap.provider, model: snap.model });
    }
    for (const m of db.models) {
      if (m.archived) info.delete(m.id); // an archived model is out of the running; its runs stay on the runs page
      const known = info.get(m.id); // today's name, colour and prices; what was run stays as it was
      if (known)
        Object.assign(known, {
          label: m.label,
          color: m.color || known.color,
          price_in: m.price_in,
          price_out: m.price_out,
          archived: Boolean(m.archived),
        });
    }

    const history: Verdict['history'] = [];
    const latest = new Map<number, number>();
    for (const run of runs) {
      const models: Verdict['history'][number]['models'] = {};
      for (const [mid, about] of info) {
        const rows = byRunModel.get(`${run.id}:${mid}`);
        const c = rows ? candidate(rows, unscored, about) : null;
        if (!c) continue;
        models[mid] = { passed: c.passed, attempted: c.attempted, cost: c.cost, latency_ms: c.latency_ms };
        latest.set(mid, run.id);
      }
      if (Object.keys(models).length) history.push({ run_id: run.id, label: run.label, created_at: run.created_at, models });
    }

    const models: VerdictModel[] = [];
    for (const [mid, runId] of latest) {
      const run = runRow(runId)!;
      const about = info.get(mid)!;
      models.push({
        id: mid,
        label: about.label,
        color: about.color,
        provider: about.provider,
        model: about.model,
        price_in: about.price_in ?? null,
        price_out: about.price_out ?? null,
        archived: about.archived ?? false,
        run_id: runId,
        run_label: run.label,
        run_at: run.created_at,
        ...candidate(byRunModel.get(`${runId}:${mid}`)!, unscored, about)!,
      });
    }
    models.sort(
      (a, b) => b.pass_rate - a.pass_rate || Number(a.cost === null) - Number(b.cost === null) || (a.cost ?? 0) - (b.cost ?? 0) || a.id - b.id,
    );

    const human = humanBoard(suiteId);
    return {
      suite: {
        id: suiteId,
        title: suite.title,
        description: suite.description ?? '',
        bar,
        exists: true,
        tasks: suite.tasks.filter((t) => t.checks.length).map((t) => ({ id: t.id, title: t.title || t.id, category: t.category })),
        ungraded: suite.tasks.filter((t) => !t.checks.length).length,
      },
      models,
      history,
      human: { models: Object.fromEntries(human.models), h2h: human.h2h, count: human.count },
      runs: runs.length,
      decision: decide(models, bar, 'cost'),
      picks: history.map((p) => ({
        run_id: p.run_id,
        pick: decide(
          Object.entries(p.models).map(([id, m]) => ({ id: Number(id), ...m })),
          bar,
          'cost',
        ).pick,
      })),
    };
  }

  // ---------- suites ----------

  const runCount = (suiteId: string) => db.runs.filter((r) => r.suite_id === suiteId).length;

  function suiteList(): SuiteSummary[] {
    return byTitle(db.suites).map((s) => {
      const count = (keys: string[]) => keys.reduce<Record<string, number>>((n, k) => ({ ...n, [k]: (n[k] ?? 0) + 1 }), {});
      const last = db.runs.filter((r) => r.suite_id === s.id).sort((a, b) => b.id - a.id)[0];
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        version: s.version,
        tasks: s.suite.tasks.length,
        categories: count(s.suite.tasks.map((t) => t.category)),
        check_types: count(s.suite.tasks.flatMap((t) => t.checks.map((c) => c.type))),
        updated_at: s.updated_at,
        runs: runCount(s.id),
        last_run: last ? { id: last.id, created_at: last.created_at, status: last.status } : null,
      };
    });
  }

  function suitePayload(id: string): SuitePayload {
    const row = suiteRow(id);
    if (!row) throw new Refusal(404, 'no such suite');
    return { ...row, runs: runCount(id) };
  }

  // ---------- models ----------

  const listModels = (archived: boolean) =>
    db.models
      .filter((m) => archived || !m.archived)
      .sort((a, b) => a.id - b.id)
      .map((m) => ({ ...m, key: keyStatus(m) }));

  /** The checks a model's settings pass on the server (`clean_model` in store.py), with its wording. */
  function cleanModel(data: Record<string, unknown>): Snapshot {
    const refuse = (message: string): never => {
      throw new Refusal(422, message);
    };
    const provider = data.provider as Provider;
    if (!Object.hasOwn(meta.providers, String(provider))) refuse(`provider must be one of ${Object.keys(meta.providers).join(', ')}`);
    const model = String(data.model ?? '').trim();
    if (!model) refuse('model id is required');
    const label = String(data.label || model)
      .trim()
      .slice(0, 60);
    const baseUrl =
      String(data.base_url ?? '')
        .trim()
        .replace(/\/+$/, '') || null;
    if (provider === 'openai-compatible' && !baseUrl) refuse('an OpenAI-compatible model needs a base URL');
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) refuse('base URL must start with http:// or https://');
    const keyEnv = String(data.api_key_env ?? '').trim() || null;
    const env = keyEnv || meta.providers[provider].key_env;
    if (env) {
      if (env.startsWith('EVALBENCH_') || !KEY_NAME.test(env)) {
        refuse(`'${env}' is not allowed as a key variable: use a name ending in _API_KEY or _TOKEN, such as GROQ_API_KEY`);
      }
      const hosts = OFFICIAL_KEYS[env];
      let host = '';
      try {
        host = baseUrl ? new URL(baseUrl).hostname.toLowerCase() : '';
      } catch {
        /* not a URL: no host to send the key to */
      }
      if (hosts && baseUrl && !hosts.includes(host)) {
        refuse(`${env} is only sent to ${hosts.join(', ')}; give this endpoint its own variable, such as GATEWAY_API_KEY`);
      }
    }
    const raw = (data.params ?? {}) as Record<string, unknown>;
    const number = (v: unknown, name: string) => (Number.isFinite(Number(v)) ? Number(v) : refuse(`${name} must be a number`));
    const params: Model['params'] = {};
    if (!blank(raw.max_tokens)) params.max_tokens = Math.max(1, Math.min(Math.trunc(number(raw.max_tokens, 'max tokens')), 128_000));
    if (!blank(raw.temperature) && provider !== 'anthropic') params.temperature = Math.max(0, Math.min(number(raw.temperature, 'temperature'), 2));
    if (EFFORTS.includes(raw.effort as string) && provider !== 'openai-compatible') params.effort = raw.effort as string;
    if (!blank(raw.timeout)) params.timeout = Math.max(5, Math.min(Math.trunc(number(raw.timeout, 'timeout')), 3600));
    const concurrency = Math.max(1, Math.min(Math.trunc(number(data.concurrency || (provider === 'openai-compatible' ? 1 : 4), 'concurrency')), 32));
    return { id: 0, label, provider, base_url: baseUrl, model, api_key_env: keyEnv, params, concurrency, color: String(data.color ?? '').trim() };
  }

  /** Dollars per million tokens. Empty is unknown; zero is a real price, for a model you run yourself. */
  function cleanPrices(data: Record<string, unknown>): Pick<Model, 'price_in' | 'price_out'> {
    const price = (value: unknown): number | null => {
      if (blank(value)) return null;
      const n = Number(value);
      if (!(n >= 0 && n <= 100_000)) throw new Refusal(422, 'a price is dollars per million tokens, zero or more');
      return n;
    };
    return { price_in: price(data.price_in), price_out: price(data.price_out) };
  }

  function createModel(data: Record<string, unknown>) {
    const m = cleanModel(data);
    if (!m.color) {
      const used = new Set(db.models.filter((x) => !x.archived).map((x) => x.color));
      m.color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[db.models.length % PALETTE.length];
    }
    const row: ModelRow = { ...m, ...cleanPrices(data), id: nextId(db.models), archived: false, created_at: iso(now()), key: keyStatus(m) };
    db.models.push(row);
    return { ...row };
  }

  function updateModel(id: number, data: Record<string, unknown>) {
    const current = db.models.find((m) => m.id === id);
    if (!current) throw new Refusal(404, 'no such model');
    const m = cleanModel({ ...current, ...data });
    Object.assign(current, { ...m, ...cleanPrices({ ...current, ...data }), id, color: m.color || current.color });
    current.key = keyStatus(current);
    return { ...current };
  }

  /** A model with results is archived, so history stays whole; one with none is deleted. */
  function removeModel(id: number) {
    const current = db.models.find((m) => m.id === id);
    if (current && db.runs.some((r) => r.models.some((m) => m.id === id))) {
      current.archived = true;
      return { result: 'archived' };
    }
    db.models = db.models.filter((m) => m.id !== id);
    return { result: 'deleted' };
  }

  // ---------- downloads ----------

  function labels(): Map<number, string> {
    const out = new Map(db.models.map((m) => [m.id, m.label]));
    for (const run of db.runs) for (const m of run.models) if (!out.has(m.id)) out.set(m.id, m.label ?? String(m.id));
    return out;
  }

  function ratingRecords(suiteId: string | null) {
    const names = labels();
    const out = [];
    for (const g of db.ratings) {
      if (suiteId && g.suite_id !== suiteId) continue;
      const a = db.results.find((r) => r.id === g.result_a);
      const b = db.results.find((r) => r.id === g.result_b);
      const run = a && runRow(a.run_id);
      if (!a || !b || !run) continue;
      const suite = suiteFor(run);
      const task = taskOf(suite, g.task_id);
      const p = g.preference;
      out.push({
        rating_id: g.id,
        created_at: g.created_at,
        rater: g.rater,
        suite: g.suite_id,
        run_id: run.id,
        task_id: g.task_id,
        category: task ? task.category : '',
        system: task ? systemFor(suite, task) : null,
        prompt: task ? task.prompt : '',
        response_a: a.output,
        response_b: b.output,
        model_a: names.get(g.model_a) ?? String(g.model_a),
        model_b: names.get(g.model_b) ?? String(g.model_b),
        preference: p,
        preference_label: preferenceLabel(p),
        winner: p < 0 ? 'a' : p > 0 ? 'b' : 'tie',
        strength: Math.abs(p),
        scores: g.scores,
        flags: g.flags,
        justification: g.justification,
        confidence: g.confidence,
        seconds: g.seconds,
      });
    }
    return out;
  }

  const CSV_BASE = [
    'rating_id',
    'created_at',
    'rater',
    'suite',
    'run_id',
    'task_id',
    'category',
    'prompt',
    'response_a',
    'response_b',
    'model_a',
    'model_b',
    'preference',
    'preference_label',
    'winner',
    'strength',
    'confidence',
    'seconds',
    'justification',
  ] as const;

  function ratingsCsv(suiteId: string | null): string {
    const records = ratingRecords(suiteId);
    const dims = [...new Set(records.flatMap((r) => [...Object.keys(r.scores.a ?? {}), ...Object.keys(r.scores.b ?? {})]))].sort();
    const header = [...CSV_BASE, 'flags_a', 'flags_b', ...dims.map((d) => `a_${d}`), ...dims.map((d) => `b_${d}`)];
    const rows = records.map((r) => [
      ...CSV_BASE.map((k) => r[k]),
      (r.flags.a ?? []).join('|'),
      (r.flags.b ?? []).join('|'),
      ...dims.map((d) => r.scores.a?.[d] ?? ''),
      ...dims.map((d) => r.scores.b?.[d] ?? ''),
    ]);
    return [header, ...rows].map((row) => `${row.map(csvCell).join(',')}\n`).join('');
  }

  /** One line per decisive rating: the prompt, the chosen answer and the rejected one. Ties are left out. */
  function preferencePairs(suiteId: string | null, minStrength: number): string {
    return ratingRecords(suiteId)
      .filter((r) => r.winner !== 'tie' && r.strength >= minStrength)
      .map((r) => {
        const aWins = r.winner === 'a';
        return `${pyJson({
          prompt: r.prompt,
          chosen: aWins ? r.response_a : r.response_b,
          rejected: aWins ? r.response_b : r.response_a,
          system: r.system,
          meta: {
            suite: r.suite,
            task_id: r.task_id,
            chosen_model: aWins ? r.model_a : r.model_b,
            rejected_model: aWins ? r.model_b : r.model_a,
            strength: r.strength,
            rating_id: r.rating_id,
            justification: r.justification,
          },
        })}\n`;
      })
      .join('');
  }

  function resultsJsonl(runId: number | null, suiteId: string | null): string {
    const names = labels();
    return db.results
      .filter((r) => (r.status === 'done' || r.status === 'error') && (runId === null || r.run_id === runId))
      .map((r) => ({ r, run: runRow(r.run_id)! }))
      .filter(({ run }) => !suiteId || run.suite_id === suiteId)
      .map(
        ({ r, run }) =>
          `${pyJson({
            result_id: r.id,
            run_id: r.run_id,
            run_label: run.label,
            suite: run.suite_id,
            task_id: r.task_id,
            task_hash: r.task_hash,
            category: r.category,
            model: names.get(r.model_id) ?? String(r.model_id),
            status: r.status,
            output: r.output,
            error: r.error,
            finish_reason: r.finish_reason,
            checks: r.checks,
            score: r.score,
            passed: r.passed === null ? null : Boolean(r.passed),
            latency_ms: r.latency_ms,
            input_tokens: r.input_tokens,
            output_tokens: r.output_tokens,
            completed_at: r.completed_at,
          })}\n`,
      )
      .join('');
  }

  /** A file the server would send as a download, built from what the demo holds right now. */
  function file(path: string): DemoFile {
    settle();
    const url = new URL(path, 'http://demo');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const suite = url.searchParams.get('suite') || null;
    const tail = suite ? `-${safeName(suite)}` : '';
    if (parts[0] === 'suites' && parts[2] === 'yaml' && parts.length === 3) {
      return { name: `${safeName(parts[1])}.yaml`, type: 'application/yaml', text: suitePayload(parts[1]).yaml };
    }
    if (parts[0] === 'export' && parts.length === 2) {
      if (parts[1] === 'ratings.csv') return { name: `evalbench-ratings${tail}.csv`, type: 'text/csv', text: ratingsCsv(suite) };
      if (parts[1] === 'ratings.jsonl') {
        const text = ratingRecords(suite)
          .map((r) => `${pyJson(r)}\n`)
          .join('');
        return { name: `evalbench-ratings${tail}.jsonl`, type: 'application/jsonl', text };
      }
      if (parts[1] === 'preferences.jsonl') {
        const min = Number(url.searchParams.get('min_strength') ?? 1) || 1;
        return { name: `evalbench-preferences${tail}.jsonl`, type: 'application/jsonl', text: preferencePairs(suite, min) };
      }
      if (parts[1] === 'results.jsonl') {
        const run = url.searchParams.get('run');
        return {
          name: `evalbench-results${run ? `-run${Number(run)}` : ''}${tail}.jsonl`,
          type: 'application/jsonl',
          text: resultsJsonl(run ? Number(run) : null, suite),
        };
      }
    }
    throw new Refusal(404, `The demo has no file at ${url.pathname}.`);
  }

  // ---------- the API surface ----------

  function route(method: string, path: string, body: unknown): unknown {
    const url = new URL(path, 'http://demo');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const query = url.searchParams;
    const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const [head, id, action, extra] = parts;
    const is = (m: string, length: number) => method === m && parts.length === length;

    switch (head) {
      case 'health':
        if (is('GET', 1)) return { ok: true, version: version };
        break;
      case 'meta':
        if (is('GET', 1)) return { ...meta, version: version, username: null, data_dir: 'this browser tab, until it reloads' };
        break;
      case 'overview':
        if (is('GET', 1)) return overview();
        break;
      case 'demo':
        if (is('POST', 1)) return { ok: true, already: true };
        break;
      case 'auth':
        if (is('POST', 2) && (id === 'login' || id === 'logout')) return { ok: true };
        if (is('POST', 2) && (id === 'setup' || id === 'username')) throw new Refusal(409, LIMITS.account);
        break;
      case 'suites':
        if (is('GET', 1)) return suiteList();
        if (is('POST', 1)) throw new Refusal(422, LIMITS.suites);
        if (is('POST', 2) && id === 'validate') return { ok: true };
        if (is('GET', 2)) return suitePayload(id);
        if (is('PUT', 2)) {
          suitePayload(id);
          throw new Refusal(422, { errors: [LIMITS.suites] });
        }
        if (is('DELETE', 2)) throw new Refusal(422, LIMITS.suites);
        break;
      case 'models':
        if (is('GET', 1)) return listModels(query.get('archived') === 'true');
        if (is('POST', 1)) return createModel(data);
        if (is('POST', 2) && id === 'discover') {
          if (!Object.hasOwn(meta.providers, String(data.provider || 'openai-compatible'))) throw new Refusal(422, 'unknown provider');
          return { ok: false, error: LIMITS.discover, models: [] };
        }
        if (is('PUT', 2)) return updateModel(Number(id), data);
        if (is('DELETE', 2)) return removeModel(Number(id));
        if (is('POST', 3) && action === 'test') {
          if (!db.models.some((m) => m.id === Number(id))) throw new Refusal(404, 'no such model');
          return { ok: false, error: LIMITS.connection };
        }
        break;
      case 'runs':
        if (is('GET', 1)) return runList(query.get('suite')).map((r) => ({ ...r, active: sims.has(r.id) }));
        if (is('POST', 1)) return createRun(data);
        if (is('GET', 2)) return runDetail(Number(id));
        if (is('DELETE', 2)) return deleteRun(Number(id));
        if (is('POST', 3) && action === 'cancel') return cancelRun(Number(id));
        if (is('POST', 3) && action === 'resume') return resumeRun(Number(id));
        if (is('GET', 4) && action === 'tasks') return taskAnswers(Number(id), extra);
        break;
      case 'rate':
        if (is('GET', 2) && id === 'next') {
          const run = query.get('run');
          const suite = query.get('suite');
          if (!run && !suite) throw new Refusal(422, 'choose a run or a suite to rate');
          const skip = (query.get('skip') ?? '').split(',').filter(Boolean);
          return nextPair(query.get('rater') ?? '', run ? { run: Number(run) } : { suite: suite! }, skip);
        }
        break;
      case 'ratings':
        if (is('GET', 1)) return ratingRows(query.get('suite') || null, Number(query.get('limit') ?? 200));
        if (is('POST', 1)) return saveRating(data);
        break;
      case 'scoreboard':
        if (is('GET', 2)) return scoreboard(id);
        break;
      case 'verdict':
        if (is('GET', 2)) return verdict(id);
        break;
      case 'export':
        if (is('GET', 2) && id === 'summary') {
          return {
            ratings: db.ratings.length,
            pairs: db.ratings.filter((g) => g.preference !== 0).length,
            results: db.results.filter((r) => r.status === 'done' || r.status === 'error').length,
            suites: byTitle(db.suites).map((s) => ({ id: s.id, title: s.title })),
          };
        }
        break;
    }
    throw new Refusal(404, `The demo has no answer for ${method} ${url.pathname}.`);
  }

  /** One API call: the status and JSON body the server would send. Nothing leaves the page. */
  async function request(method: string, path: string, body?: unknown): Promise<Reply> {
    try {
      settle();
      const data = route(method.toUpperCase(), path, body === undefined ? undefined : copy(body));
      return { status: 200, data: copy(data) };
    } catch (e) {
      if (e instanceof Refusal) return { status: e.status, data: { detail: e.detail } };
      throw e;
    }
  }

  return { request, file };
}

export type Backend = ReturnType<typeof createBackend>;
