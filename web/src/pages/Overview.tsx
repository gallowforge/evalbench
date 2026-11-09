import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { api, type Board, type Overview as OverviewData } from '../api';
import { HistoryChart, Sparkline } from '../components/charts';
import { NewRunModal, RunRow } from '../components/runs';
import { Card, cx, ErrorNote, Loading, ModelDot } from '../components/ui';
import { ago, ms, pct, plural } from '../lib/format';

type Row = Board['models'][number];

/** "Core battery" reads as "the core battery" mid-sentence; "CS tasks" keeps its capitals. */
const inSentence = (t: string) => (t.length > 1 && t[1] === t[1].toLowerCase() ? t[0].toLowerCase() + t.slice(1) : t);

/** The overview writes its own headline, like the front page of a results sheet. */
function headline(board: Board & { title: string }): { title: string; detail: string } {
  const ranked = board.models.filter((m) => m.auto);
  if (!ranked.length) return { title: `${board.title} is waiting for its first run.`, detail: '' };
  const top = ranked[0];
  const tied = ranked.filter((m) => m.auto?.pass_rate === top.auto?.pass_rate);
  const byJudges: Row[] = [...tied].sort((a, b) => (b.human?.rating ?? 0) - (a.human?.rating ?? 0));
  const leader = byJudges[0];
  let title = `${leader.label} leads the ${inSentence(board.title)}.`;
  if (tied.length > 1 && !leader.human) title = `${tied.map((m) => m.label).join(' and ')} share the lead.`;
  const run = leader.auto!;
  let detail = `${pct(run.pass_rate)} of checks passed in run #${run.run_id}`;
  const others = tied.filter((m) => m !== leader && m.human).map((m) => m.label);
  if (others.length && leader.human) detail += `, level with ${others.join(' and ')}, but the judges prefer it`;
  if (leader.human?.win_rate != null) detail += `${others.length ? '' : ', and judges pick it'} in ${pct(leader.human.win_rate)} of blind pairs`;
  detail += '.';
  const worst = [...board.regressions].sort((a, b) => b.regressed - a.regressed)[0];
  const who = worst && board.models.find((m) => m.id === worst.model_id);
  if (worst && worst.regressed > 0 && who) detail += ` ${who.label} dropped ${plural(worst.regressed, 'task')} since run #${worst.from_run}.`;
  else if (board.regressions.length) detail += ' Nothing regressed since the last run.';
  return { title, detail };
}

function Scorecard({ board }: { board: Board & { id: string; title: string } }) {
  return (
    <section className="card overflow-hidden">
      <div className="hidden grid-cols-[44px_minmax(0,1.3fr)_minmax(170px,1fr)_120px_120px_80px] items-end gap-x-6 border-b border-line px-7 pt-5 pb-3 text-[12.5px] font-semibold text-muted md:grid">
        <span />
        <span>Model</span>
        <span>Checks passed</span>
        <span>Judges</span>
        <span>Last six runs</span>
        <span className="text-right">Median</span>
      </div>
      {board.models.map((m, i) => {
        const trend = board.history
          .map((h) => h.models[String(m.id)]?.pass_rate)
          .filter((v): v is number => v !== undefined)
          .slice(-6);
        return (
          <div
            key={m.id}
            className={cx(
              'grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-5 md:grid-cols-[44px_minmax(0,1.3fr)_minmax(170px,1fr)_120px_120px_80px] md:gap-x-6 md:px-7',
              i > 0 && 'border-t border-line',
            )}
          >
            <span className="slab text-[26px] leading-none font-semibold text-faint">{i + 1}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2.5">
                <ModelDot color={m.color} size={10} />
                <span className="truncate text-[17px] font-semibold tracking-[-0.01em]">{m.label}</span>
              </span>
              {m.model && <span className="mt-0.5 block truncate pl-[20px] font-mono text-[11.5px] text-faint">{m.model}</span>}
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2.5">
                <span className="slab text-[34px] leading-none font-semibold">{pct(m.auto?.pass_rate)}</span>
                {m.auto && (
                  <span className="hidden text-[13px] text-muted sm:inline">
                    {m.auto.passed} of {m.auto.attempted}
                  </span>
                )}
              </span>
              <span className="mt-2.5 hidden h-[5px] max-w-[190px] overflow-hidden rounded-full bg-ink/[0.07] sm:block">
                <span className="block h-full rounded-full" style={{ width: `${(m.auto?.pass_rate ?? 0) * 100}%`, background: m.color }} />
              </span>
            </span>
            <span className="hidden md:block">
              {m.human ? (
                <>
                  <span className="slab block text-[26px] leading-none font-semibold">{Math.round(m.human.rating)}</span>
                  <span className="mt-1.5 block text-[12.5px] text-muted">picked in {pct(m.human.win_rate)}</span>
                </>
              ) : (
                <span className="text-[13px] text-faint">not judged yet</span>
              )}
            </span>
            <span className="hidden md:block">
              <Sparkline values={trend} color={m.color} />
            </span>
            <span className="hidden text-right text-[14px] text-muted md:block">{ms(m.auto?.latency_ms)}</span>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2 px-5 py-3.5 text-[13.5px] text-muted md:px-7">
        <span>
          {plural(board.runs, 'run')} · {plural(board.ratings, 'blind verdict')} · judges are a Bradley-Terry rating where 1000 is average
        </span>
        <Link href={`/scoreboard/${board.id}`} className="link inline-flex items-center gap-1">
          Full scoreboard <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}

function SinceLastRun({ board }: { board: Board }) {
  if (!board.regressions.length) return <div className="text-[14px] text-muted">Run the suite twice to see what changed.</div>;
  const rows = [...board.regressions].sort((a, b) => b.regressed - a.regressed || b.fixed - a.fixed);
  return (
    <div className="divide-y divide-line">
      {rows.map((r) => {
        const m = board.models.find((x) => x.id === r.model_id);
        if (!m) return null;
        const failing = r.changes.filter((c) => c.kind === 'regression');
        return (
          <div key={r.model_id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-4 py-4 first:pt-0 last:pb-0">
            <span className={cx('slab text-[40px] leading-[0.9] font-semibold', r.regressed ? 'text-mark' : 'text-line-2')}>{r.regressed}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                <ModelDot color={m.color} /> {m.label}
              </span>
              <span className="mt-1 block text-[13.5px] leading-snug text-muted">
                {r.regressed
                  ? `${r.regressed === 1 ? 'task now fails' : 'tasks now fail'}: ${failing.map((c) => board.task_titles[c.task_id] ?? c.task_id).join(', ')}`
                  : r.fixed
                    ? `${plural(r.fixed, 'task')} fixed, nothing broke`
                    : `nothing changed since run #${r.from_run}`}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Overview() {
  const qc = useQueryClient();
  const [newRun, setNewRun] = useState(false);
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview'), refetchInterval: 5_000 });
  const demo = useMutation({ mutationFn: () => api.post('/demo'), onSuccess: () => qc.invalidateQueries() });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const toJudge = d.rating.reduce((n, r) => n + r.remaining, 0);

  if (!d.counts.runs) {
    return (
      <div className="pt-4">
        <h1 className="max-w-[15ch] text-[48px] leading-[0.98] font-bold tracking-[-0.045em] md:text-[78px]">Judge the answer, not the name.</h1>
        <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-ink-2">
          Write tasks, run them on any model, grade every answer automatically, and let people rate pairs of answers without knowing who wrote them.
        </p>
        <div className="mt-14 grid gap-10 border-t border-line pt-10 md:grid-cols-3">
          {[
            {
              n: 1,
              title: 'Add a model',
              text: 'LM Studio, Ollama, Anthropic, OpenAI or any compatible server. Keys stay in the environment.',
              href: '/models',
              cta: 'Add a model',
            },
            {
              n: 2,
              title: 'Run a suite',
              text: 'The core battery is ready: reasoning, constraints and debugging, graded by checks and tests.',
              href: '/runs',
              cta: 'Start a run',
            },
            {
              n: 3,
              title: 'Judge blind',
              text: 'Two anonymous answers, a rubric, a verdict and a reason. The labels come off at the end.',
              href: '/rate',
              cta: 'Open judging',
            },
          ].map((s) => (
            <div key={s.n}>
              <div className="slab text-[60px] leading-none font-semibold text-line-2">{s.n}</div>
              <div className="mt-4 text-[19px] font-semibold tracking-[-0.01em]">{s.title}</div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{s.text}</p>
              <Link href={s.href} className="link mt-3 inline-flex items-center gap-1 text-[14.5px]">
                {s.cta} <ArrowRight size={15} />
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap items-center gap-5 rounded-[18px] bg-ink px-7 py-6 text-panel">
          <div className="min-w-0 flex-1">
            <div className="text-[19px] font-semibold tracking-[-0.01em]">See it with data first</div>
            <div className="mt-1 text-[14.5px] text-panel/65">Six weekly runs, four fictional models and 88 blind verdicts. No keys needed.</div>
          </div>
          <button className="btn h-11 bg-panel px-5 text-ink hover:bg-white" onClick={() => demo.mutate()} disabled={demo.isPending}>
            {demo.isPending ? 'Setting the table' : 'Load the demo workspace'} <ArrowRight size={16} />
          </button>
        </div>
        <div className="mt-4">
          <ErrorNote error={demo.error} />
        </div>
      </div>
    );
  }

  const main = d.boards[0];
  const head = main ? headline(main) : null;
  const latest = d.recent_runs.find((r) => r.suite_id === main?.suite_id) ?? d.recent_runs[0];

  return (
    <>
      <header className="mb-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          {main && latest && (
            <div className="mb-4 text-[14px] font-medium text-muted">
              {main.title} · run #{latest.id}
              {latest.label ? `, ${latest.label}` : ''} · {ago(latest.finished_at ?? latest.created_at)}
            </div>
          )}
          <h1 className="max-w-[20ch] text-[40px] leading-[1] font-bold tracking-[-0.045em] text-balance md:text-[60px]">
            {head?.title ?? 'Overview'}
          </h1>
          {head?.detail && <p className="mt-5 max-w-[60ch] text-[17px] leading-relaxed text-ink-2">{head.detail}</p>}
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/rate" className="btn-primary h-11 px-5">
            {toJudge ? `Judge ${plural(toJudge, 'pair')}` : 'Judge'} <ArrowRight size={16} />
          </Link>
          <button className="btn-ghost h-11 px-5" onClick={() => setNewRun(true)}>
            New run
          </button>
        </div>
      </header>

      {d.boards.map((b) => (
        <div key={b.id} className="mb-6">
          <Scorecard board={b} />
        </div>
      ))}

      {main && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <Card title="Pass rate over time" className="min-w-0">
            <HistoryChart board={main} height={290} />
          </Card>
          <Card title={main.regressions[0] ? `Since run #${main.regressions[0].from_run}` : 'Since the last run'}>
            <SinceLastRun board={main} />
          </Card>
        </div>
      )}

      <Card
        title="Recent runs"
        action={
          <Link href="/runs" className="link text-[14px]">
            All runs
          </Link>
        }
        pad={false}
      >
        <div className="px-2 pt-1 pb-2">
          {d.recent_runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      </Card>

      <p className="mt-10 text-center text-[13px] text-faint">
        {d.counts.answers.toLocaleString('en-US')} answers graded by {d.counts.checks_run.toLocaleString('en-US')} automatic checks, and{' '}
        {plural(d.counts.ratings, 'blind verdict')} so far.
      </p>
      <NewRunModal open={newRun} onClose={() => setNewRun(false)} />
    </>
  );
}
