#!/usr/bin/env node
// Regenerates the sample data behind the static demo (src/demo/data/*.json) from a running
// Evalbench that holds the demo workspace. Run it after the demo workspace, a response shape
// or the statistics change, so the data is never edited by hand.
//
//   EVALBENCH_DATA=$(mktemp -d) EVALBENCH_PORT=8591 EVALBENCH_DEMO=1 EVALBENCH_AUTH=off \
//     EVALBENCH_SANDBOX=local NIMBUS_API_KEY=demo .venv/bin/evalbench serve &
//   node web/scripts/capture-demo.mjs http://127.0.0.1:8591
//
// Two files come out:
//   fixtures.json   the records the demo starts from: suites, models, runs, answers, ratings
//   snapshots.json  what the real server answered for the computed pages, so the tests can hold
//                   the in-browser adapter to the same numbers

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = (process.argv[2] || process.env.ORIGIN || 'http://127.0.0.1:8484').replace(/\/$/, '');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'demo', 'data');

async function raw(path) {
  const res = await fetch(`${origin}/api${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.text();
}
const get = async (path) => JSON.parse(await raw(path));

/** Key order never changes a digest: objects are written with their keys sorted. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 20);
const digest = (value) => sha(canonical(value));
const jsonl = (text) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

function fail(message) {
  console.error(`capture-demo: ${message}`);
  process.exit(1);
}

const meta = await get('/meta').catch((e) => fail(`${origin} is not answering (${e.message}). Start a demo server first.`));
if (!meta.demo) fail(`${origin} does not hold the demo workspace. Start it with EVALBENCH_DEMO=1 on an empty data directory.`);

// Nothing about the machine that made the capture belongs in the data.
delete meta.version;
delete meta.data_dir;
delete meta.username;
meta.auth = false;
meta.authenticated = true;
meta.sandbox = { mode: 'demo', ok: true };
for (const key of Object.values(meta.keys ?? {})) key.present = false;

const suites = [];
for (const s of await get('/suites')) {
  const { runs: _runs, ...payload } = await get(`/suites/${encodeURIComponent(s.id)}`);
  suites.push(payload);
}
const hashes = Object.fromEntries(suites.map((s) => [s.id, s.hashes]));

const models = await get('/models?archived=true');

const runs = [];
const results = [];
const bodies = {};
const digests = {};
const runList = await get('/runs');
for (const item of [...runList].sort((a, b) => a.id - b.id)) {
  const detail = await get(`/runs/${item.id}`);
  if (detail.active || !['done', 'failed', 'cancelled'].includes(detail.status)) fail(`run ${item.id} is still going; wait for it to finish.`);
  digests[`/runs/${item.id}`] = digest(detail);
  runs.push({
    id: detail.id,
    suite_id: detail.suite_id,
    suite_title: detail.suite_title,
    label: detail.label,
    status: detail.status,
    created_at: detail.created_at,
    started_at: detail.started_at,
    finished_at: detail.finished_at,
    models: detail.models.map(({ summary: _summary, ...snapshot }) => snapshot),
  });
  const answers = [];
  for (const task of detail.tasks) {
    const t = await get(`/runs/${item.id}/tasks/${encodeURIComponent(task.id)}`);
    answers.push(t);
    for (const row of t.answers) {
      // The adapter reads a task's prompt, checks and rubric from the suite as it is now.
      if (hashes[detail.suite_id]?.[row.task_id] !== row.task_hash) {
        fail(`run ${item.id} answered an older version of ${row.task_id}; the demo data needs every run on the current suite text.`);
      }
      results.push(row);
    }
  }
  digests[`/runs/${item.id}/tasks/*`] = digest(answers);
}
results.sort((a, b) => a.id - b.id);

const ratings = (await get('/ratings?limit=1000000')).map(({ preference_label: _label, ...row }) => row).sort((a, b) => a.id - b.id);

// ---------- what the server computed, for the parity tests ----------

bodies['/overview'] = await get('/overview');
bodies['/runs'] = runList;
bodies['/suites'] = await get('/suites');
bodies['/models'] = await get('/models');
bodies['/export/summary'] = await get('/export/summary');
digests['/ratings?limit=200'] = digest(await get('/ratings?limit=200'));
const raters = [...new Set(ratings.map((r) => r.rater))].sort();
for (const s of suites) {
  const id = encodeURIComponent(s.id);
  bodies[`/scoreboard/${id}`] = await get(`/scoreboard/${id}`);
  digests[`/suites/${id}`] = digest(await get(`/suites/${id}`));
  digests[`/ratings?limit=5&suite=${id}`] = digest(await get(`/ratings?limit=5&suite=${id}`));
  for (const rater of [...raters, 'someone-new']) {
    const next = await get(`/rate/next?suite=${id}&rater=${encodeURIComponent(rater)}`);
    bodies[`/rate/next?suite=${id}&rater=${rater}`] = { done: next.done, progress: next.progress };
  }
  digests[`/suites/${id}/yaml`] = sha(await raw(`/suites/${id}/yaml`));
  digests[`/export/ratings.csv?suite=${id}`] = sha(await raw(`/export/ratings.csv?suite=${id}`));
}
const lastRun = runs.at(-1)?.id;
if (lastRun) {
  const next = await get(`/rate/next?run=${lastRun}&rater=${encodeURIComponent(raters[0] ?? '')}`);
  bodies[`/rate/next?run=${lastRun}&rater=${raters[0] ?? ''}`] = { done: next.done, progress: next.progress };
  digests[`/export/results.jsonl?run=${lastRun}`] = digest(jsonl(await raw(`/export/results.jsonl?run=${lastRun}`)));
}
digests['/export/ratings.csv'] = sha(await raw('/export/ratings.csv'));
digests['/export/ratings.jsonl'] = digest(jsonl(await raw('/export/ratings.jsonl')));
digests['/export/preferences.jsonl'] = digest(jsonl(await raw('/export/preferences.jsonl')));
digests['/export/results.jsonl'] = digest(jsonl(await raw('/export/results.jsonl')));

// ---------- a last look for anything private, then write ----------

const fixtures = { captured_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), meta, suites, models, runs, results, ratings };
const snapshots = { captured_at: fixtures.captured_at, bodies, digests };

const text = JSON.stringify([fixtures, snapshots]);
const private_ = [
  [/\/(home|Users|tmp|var|root)\/[\w.-]+/, 'a path on this machine'],
  [/\b(sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{16,}/, 'something shaped like an API key'],
  [/[\w.+-]+@(?!example\.)[\w-]+\.[a-z]{2,}/i, 'an email address'],
];
for (const [pattern, what] of private_) {
  const hit = text.match(pattern);
  if (hit) fail(`the capture holds ${what} ("${hit[0].slice(0, 40)}"). Nothing was written.`);
}

/** One record per line, so a change in the data reads as a change in a diff. */
function lines(value) {
  const parts = Object.entries(value).map(([key, v]) => {
    const body = Array.isArray(v)
      ? `[\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`
      : v && typeof v === 'object'
        ? `{\n${Object.entries(v)
            .map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x)}`)
            .join(',\n')}\n}`
        : JSON.stringify(v);
    return `${JSON.stringify(key)}:${body}`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'fixtures.json'), lines(fixtures));
writeFileSync(join(out, 'snapshots.json'), lines(snapshots));
console.log(
  `captured ${suites.length} suite(s), ${models.length} models, ${runs.length} runs, ${results.length} answers and ${ratings.length} ratings from ${origin}`,
);
