export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/setup') {
    window.dispatchEvent(new Event('evalbench:auth'));
  }
  if (!res.ok) {
    let message = res.statusText;
    let details: string[] = [];
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') message = data.detail;
      else if (data.detail?.errors) {
        details = data.detail.errors;
        message = details[0] ?? message;
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, details);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// ---------- types (mirror the API) ----------

export type Provider = 'anthropic' | 'openai' | 'openai-compatible';

export interface Meta {
  version: string;
  auth: boolean;
  setup_required: boolean;
  /** An install from before usernames, waiting for its owner to pick one. */
  username_required: boolean;
  username_from_env: boolean;
  password_from_env: boolean;
  authenticated: boolean;
  username?: string | null;
  demo?: boolean;
  data_dir?: string;
  concurrency?: number;
  min_justification?: number;
  sandbox?: { mode: 'local' | 'container' | 'off'; ok: boolean };
  keys?: Record<string, { env: string | null; present: boolean }>;
  providers?: Record<Provider, { label: string; key_env: string | null; base_url: string | null; max_tokens: number; suggested: string[] }>;
  presets?: Preset[];
  rating?: RatingOptions;
}

export interface Preset {
  id: string;
  label: string;
  provider: Provider;
  base_url: string | null;
  concurrency: number;
}

export interface RatingOptions {
  flags: { id: string; label: string }[];
  scale: { value: number; label: string }[];
  preference: { value: number; label: string }[];
  confidence: string[];
}

export interface Model {
  id: number;
  label: string;
  provider: Provider;
  base_url: string | null;
  model: string;
  api_key_env: string | null;
  params: { max_tokens?: number; temperature?: number; effort?: string; timeout?: number };
  concurrency: number;
  color: string;
  archived: boolean;
  key: { env: string | null; present: boolean };
}

export interface ModelRef {
  id: number;
  label: string;
  color: string;
  provider?: Provider;
  model?: string;
}

export interface Check {
  type: 'exact' | 'contains' | 'not_contains' | 'regex' | 'length' | 'json' | 'python';
  label?: string | null;
  weight?: number;
  extract?: string | null;
  expect?: string | string[] | null;
  mode?: 'all' | 'any';
  case_sensitive?: boolean;
  pattern?: string | null;
  flags?: string;
  fullmatch?: boolean;
  negate?: boolean;
  unit?: 'words' | 'chars' | 'lines' | 'sentences';
  min?: number | null;
  max?: number | null;
  required?: string[] | null;
  equals?: Record<string, unknown> | null;
  tests?: string | null;
  timeout?: number;
}

export interface RubricDimension {
  id: string;
  label: string;
  description: string;
}

export interface Task {
  id: string;
  title: string;
  category: string;
  prompt: string;
  system?: string | null;
  reference?: string | null;
  notes?: string | null;
  checks: Check[];
  rubric?: RubricDimension[] | null;
}

export interface Suite {
  id: string;
  title: string;
  description: string;
  version: number | string;
  system?: string | null;
  rubric: RubricDimension[];
  tasks: Task[];
}

export interface SuiteSummary {
  id: string;
  title: string;
  description: string;
  version: number | string;
  tasks: number;
  categories: Record<string, number>;
  check_types: Record<string, number>;
  updated_at: string;
  runs: number;
  last_run: { id: number; created_at: string; status: string } | null;
}

export interface SuitePayload {
  id: string;
  title: string;
  description: string;
  version: number | string;
  yaml: string;
  suite: Suite;
  hashes: Record<string, string>;
  updated_at: string;
  runs: number;
}

export interface Summary {
  total: number;
  done: number;
  errors: number;
  pending: number;
  scored: number;
  attempted: number;
  passed: number;
  pass_rate: number | null;
  mean_score: number | null;
  latency_ms: number | null;
  output_tokens: number | null;
  categories: Record<string, number>;
}

export interface CheckResult {
  type: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface Result {
  id: number;
  run_id: number;
  task_id: string;
  task_hash: string;
  category: string;
  model_id: number;
  status: 'pending' | 'running' | 'done' | 'error';
  score: number | null;
  passed: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  finish_reason: string | null;
  error: string | null;
  checks: CheckResult[];
  output?: string | null;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface RunListItem {
  id: number;
  suite_id: string;
  suite_title: string;
  label: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  active: boolean;
  tasks: number;
  progress: { total: number; finished: number };
  models: (ModelRef & {
    pass_rate: number | null;
    mean_score: number | null;
    errors: number;
    latency_ms: number | null;
    scored: number;
    passed: number;
  })[];
}

export interface RunDetail {
  id: number;
  suite_id: string;
  suite_title: string;
  label: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  active: boolean;
  tasks: { id: string; title: string; category: string; checks: number }[];
  categories: string[];
  models: (ModelRef & { summary: Summary })[];
  results: Result[];
  progress: { total: number; finished: number };
  rating: { total: number; rated: number; remaining: number };
}

export interface TaskAnswers {
  task: Task;
  answers: Result[];
}

export interface Pair {
  done: false;
  suite_id: string;
  run_id: number | null;
  key: string;
  task: { id: string; title: string; category: string; prompt: string; system: string | null; reference: string | null; notes: string | null };
  rubric: RubricDimension[];
  a: { result_id: number; output: string };
  b: { result_id: number; output: string };
  progress: { total: number; rated: number; remaining: number };
}

export type NextPair = Pair | { done: true; progress: { total: number; rated: number; remaining: number } };

export interface Board {
  suite_id: string;
  models: (ModelRef & {
    auto: (Summary & { run_id: number }) | null;
    human: { rating: number; ci: [number, number] | null; win_rate: number | null; games: number; ties: number } | null;
  })[];
  categories: string[];
  task_titles: Record<string, string>;
  history: { run_id: number; label: string; created_at: string; models: Record<string, { pass_rate: number; mean_score: number }> }[];
  regressions: {
    model_id: number;
    from_run: number;
    to_run: number;
    regressed: number;
    fixed: number;
    changes: { task_id: string; category: string; kind: 'regression' | 'fixed' | 'task_changed' | 'errored'; result_id: number }[];
  }[];
  h2h: Record<string, { wins: number; games: number }>;
  ratings: number;
  runs: number;
}

export interface Overview {
  counts: { suites: number; models: number; runs: number; answers: number; ratings: number; checks_run: number };
  boards: (Board & { id: string; title: string })[];
  recent_runs: RunListItem[];
  rating: { suite_id: string; title: string; total: number; rated: number; remaining: number }[];
  demo: boolean;
}

export interface RatingRow {
  id: number;
  suite_id: string;
  run_id: number | null;
  task_id: string;
  model_a: number;
  model_b: number;
  preference: number;
  preference_label: string;
  justification: string;
  confidence: string | null;
  rater: string;
  seconds: number | null;
  created_at: string;
  flags: { a?: string[]; b?: string[] };
}
