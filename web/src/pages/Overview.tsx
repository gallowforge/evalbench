import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Boxes, Play, Scale, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { api, type Overview as OverviewData } from '../api';
import { HistoryChart, Sparkline } from '../components/charts';
import { NewRunModal, RunRow } from '../components/runs';
import { Card, ErrorNote, Loading, ModelDot, PageHeader, Stat } from '../components/ui';
import { compact, pct, plural, thousands } from '../lib/format';

export function Overview() {
  const qc = useQueryClient();
  const [newRun, setNewRun] = useState(false);
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview'), refetchInterval: 5_000 });
  const demo = useMutation({
    mutationFn: () => api.post('/demo'),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const toRate = d.rating.reduce((n, r) => n + r.remaining, 0);
  const leader = d.boards[0]?.models[0];
  const regressed = d.boards.reduce((n, b) => n + b.regressions.reduce((k, r) => k + r.regressed, 0), 0);

  if (!d.counts.runs) {
    return (
      <>
        <PageHeader
          title="Judge the answer, not the name."
          subtitle="Write tasks, run them on any model, grade every answer, and rate them blind. Three steps to the first verdict."
        />
        <div className="card relative overflow-hidden p-8 md:p-10">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-[90px]" />
          <div className="relative grid gap-8 md:grid-cols-3">
            {[
              {
                n: 1,
                icon: <Boxes size={18} />,
                title: 'Add a model',
                text: 'LM Studio, Ollama, Anthropic, OpenAI or any OpenAI-compatible server. Keys stay in the environment.',
                href: '/models',
                cta: 'Add a model',
              },
              {
                n: 2,
                icon: <Play size={18} />,
                title: 'Run a suite',
                text: `The ${d.counts.suites === 1 ? 'core battery is' : 'sample suites are'} ready: reasoning, constraints and debugging, graded by checks and tests.`,
                href: '/runs',
                cta: 'Start a run',
              },
              {
                n: 3,
                icon: <Scale size={18} />,
                title: 'Rate blind',
                text: 'Compare two anonymous answers, score them on the rubric and explain your choice.',
                href: '/rate',
                cta: 'Open rating',
              },
            ].map((s) => (
              <div key={s.n}>
                <div className="mb-4 grid h-10 w-10 place-items-center rounded-[11px] border border-line-2 bg-white/[0.04] text-accent">{s.icon}</div>
                <div className="text-[15px] font-semibold">{s.title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.text}</p>
                <Link href={s.href} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                  {s.cta} <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
          <div className="relative mt-9 flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <button className="btn-primary" onClick={() => demo.mutate()} disabled={demo.isPending}>
              <Sparkles size={15} /> {demo.isPending ? 'Loading the demo' : 'Explore the demo workspace'}
            </button>
            <span className="text-[12.5px] text-muted">Six weekly runs, four fictional models and 90 blind ratings. No keys needed.</span>
          </div>
          <div className="relative mt-3">
            <ErrorNote error={demo.error} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Every model, every run and every rating in one place."
        actions={
          <>
            <Link href="/rate" className="btn-ghost">
              <Scale size={15} /> Rate blind
            </Link>
            <button className="btn-primary" onClick={() => setNewRun(true)}>
              <Play size={15} /> New run
            </button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Answers graded" value={thousands(d.counts.answers)} hint={`${thousands(d.counts.checks_run)} automatic checks`} accent />
        <Stat label="Blind ratings" value={thousands(d.counts.ratings)} hint={toRate ? `${plural(toRate, 'pair')} waiting` : 'All caught up'} />
        <Stat
          label="Top pass rate"
          value={leader ? pct(leader.auto?.pass_rate) : '–'}
          hint={leader ? `${leader.label} · ${d.boards[0].title}` : 'No runs yet'}
        />
        <Stat label="Regressions" value={regressed} hint={regressed ? 'newly failing since the last run' : 'none since the last run'} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {d.boards.map((b) => (
            <Card
              key={b.id}
              title={
                <span className="flex items-center gap-2">
                  {b.title} <span className="font-normal text-faint">· leaderboard</span>
                </span>
              }
              action={
                <Link href={`/scoreboard/${b.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
                  Scoreboard <ArrowUpRight size={13} />
                </Link>
              }
            >
              <div className="grid grid-cols-[20px_minmax(0,1fr)_minmax(80px,1.4fr)] sm:grid-cols-[20px_minmax(0,1fr)_minmax(80px,1.4fr)_96px_64px] items-center gap-x-4 px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.07em] text-faint">
                <span>#</span>
                <span>Model</span>
                <span>Checks passed</span>
                <span className="hidden text-right sm:block">Trend</span>
                <span className="hidden text-right sm:block">Human</span>
              </div>
              <div className="divide-y divide-line">
                {b.models.map((m, i) => {
                  const trend = b.history.map((h) => h.models[String(m.id)]?.pass_rate).filter((v): v is number => v !== undefined);
                  return (
                    <div
                      key={m.id}
                      className="grid grid-cols-[20px_minmax(0,1fr)_minmax(80px,1.4fr)] sm:grid-cols-[20px_minmax(0,1fr)_minmax(80px,1.4fr)_96px_64px] items-center gap-x-4 px-1 py-3"
                    >
                      <span className="num text-[12.5px] text-faint">{i + 1}</span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ModelDot color={m.color} />
                        <span className="truncate text-[13.5px] font-medium">{m.label}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                          <span className="block h-full rounded-full" style={{ width: `${(m.auto?.pass_rate ?? 0) * 100}%`, background: m.color }} />
                        </span>
                        <span className="slab w-11 text-right text-[16px] font-bold">{pct(m.auto?.pass_rate)}</span>
                      </span>
                      <span className="hidden justify-end sm:flex">
                        <Sparkline values={trend} color={m.color} />
                      </span>
                      <span className="num hidden text-right text-[13px] text-ink-2 sm:block">{m.human ? Math.round(m.human.rating) : '–'}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          {d.boards[0] && d.boards[0].history.length > 1 && (
            <Card
              title={
                <span>
                  Pass rate over time <span className="font-normal text-faint">· {d.boards[0].title}</span>
                </span>
              }
            >
              <HistoryChart board={d.boards[0]} height={330} />
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Ready to rate">
            {d.rating.length === 0 && <div className="text-[13px] text-muted">Run two or more models on a suite to start rating.</div>}
            {d.rating.map((r) => (
              <div key={r.suite_id}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-ink-2">{r.title}</span>
                  <span className="num text-[12px] text-muted">
                    {r.rated}/{r.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${r.total ? (r.rated / r.total) * 100 : 0}%` }} />
                </div>
                <Link href={`/rate?suite=${r.suite_id}`} className="btn-ghost mt-4 w-full">
                  <Scale size={15} /> {r.remaining ? `Rate ${plural(r.remaining, 'pair')}` : 'Review ratings'}
                </Link>
              </div>
            ))}
            <p className="mt-3 text-[12px] leading-relaxed text-faint">
              Pairs are shuffled and anonymous. Counts here are for a new rater; each rater sees their own queue.
            </p>
          </Card>

          <Card title="Since the previous run">
            {d.boards.flatMap((b) => b.regressions.map((r) => ({ ...r, board: b }))).length === 0 && (
              <div className="text-[13px] text-muted">Run a suite twice to see what changed.</div>
            )}
            <div className="space-y-3">
              {d.boards.flatMap((b) =>
                b.regressions.map((r) => {
                  const m = b.models.find((x) => x.id === r.model_id);
                  if (!m) return null;
                  return (
                    <Link
                      key={`${b.id}-${r.model_id}`}
                      href={`/scoreboard/${b.id}`}
                      className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 hover:bg-white/[0.03]"
                    >
                      <ModelDot color={m.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{m.label}</span>
                        <span className="num block text-[11.5px] text-faint">
                          run #{r.from_run} → #{r.to_run}
                        </span>
                      </span>
                      {r.regressed > 0 && (
                        <span className="chip border-bad/30 bg-bad/10 text-bad-ink">
                          <TrendingDown size={12} /> {r.regressed}
                        </span>
                      )}
                      {r.fixed > 0 && (
                        <span className="chip border-good/30 bg-good/10 text-good-ink">
                          <TrendingUp size={12} /> {r.fixed}
                        </span>
                      )}
                      {!r.regressed && !r.fixed && <span className="text-[12px] text-faint">no change</span>}
                    </Link>
                  );
                }),
              )}
            </div>
          </Card>

          <Card title="Tokens and speed">
            <div className="space-y-2.5">
              {d.boards[0]?.models.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-2 text-ink-2">
                    <ModelDot color={m.color} size={6} /> {m.label}
                  </span>
                  <span className="num text-muted">
                    {compact(m.auto?.output_tokens)} tok · {m.auto?.latency_ms ? `${(m.auto.latency_ms / 1000).toFixed(1)} s` : '–'}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-faint">Median latency and mean output tokens per answer, latest run.</p>
          </Card>
        </div>
      </div>
      <Card
        className="mt-5"
        title="Recent runs"
        action={
          <Link href="/runs" className="text-[12.5px] text-muted hover:text-ink">
            All runs
          </Link>
        }
        pad={false}
      >
        <div className="px-1 pb-2 pt-1">
          {d.recent_runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      </Card>
      <NewRunModal open={newRun} onClose={() => setNewRun(false)} />
    </>
  );
}
