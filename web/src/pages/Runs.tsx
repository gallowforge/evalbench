import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Play } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { Link } from 'wouter';
import { api, type RunListItem } from '../api';
import { NewRunModal } from '../components/runs';
import { cx, Empty, ErrorNote, Loading, ModelDot, PageHeader, StatusPill } from '../components/ui';
import { ago, duration, plural } from '../lib/format';
import { useNow } from '../lib/hooks';

type RunModel = RunListItem['models'][number];
interface Job {
  id: string;
  title: string;
  runs: RunListItem[];
  models: RunModel[];
}

/** The runs of each job, in the order they arrive (newest first), with every model the job has tried. */
function byJob(runs: RunListItem[]): Job[] {
  const jobs: Job[] = [];
  for (const r of runs) {
    let job = jobs.find((j) => j.id === r.suite_id);
    if (!job) {
      job = { id: r.suite_id, title: r.suite_title, runs: [], models: [] };
      jobs.push(job);
    }
    job.runs.push(r);
    for (const m of r.models) if (!job.models.some((x) => x.id === m.id)) job.models.push(m);
  }
  return jobs;
}

/** How many tasks a model got right on one run: the figure a column of these is read down. */
function Score({ m }: { m?: RunModel }) {
  if (!m || !m.scored) return <span className="text-[15px] text-ghost">–</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="slab text-[19px] leading-none font-semibold text-ink">{m.passed}</span>
      <span className="num text-[12.5px] text-faint">/{m.scored}</span>
      {m.errors > 0 && <span className="num ml-1.5 text-[12px] font-semibold text-serious">{plural(m.errors, 'error')}</span>}
    </span>
  );
}

function Row({ run, job, now }: { run: RunListItem; job: Job; now: number }) {
  const live = run.active || run.status === 'running';
  const progress = run.progress.total ? run.progress.finished / run.progress.total : 0;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="group block items-center gap-x-6 border-t border-line py-4 md:grid md:[grid-template-columns:var(--cols)] md:py-3.5"
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="slab w-9 shrink-0 text-[19px] leading-none font-semibold text-faint">#{run.id}</span>
        <span className="min-w-0 truncate text-[15px] font-semibold text-ink underline-offset-4 group-hover:underline">
          {run.label || run.suite_title}
        </span>
        {run.status !== 'done' && <StatusPill status={run.status} />}
        {/* On a phone the date sits on the run's own line; on a desk it has a column. */}
        <span className="ml-auto shrink-0 text-[13px] text-muted md:hidden">{ago(run.created_at, now)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-7 gap-y-2 pl-[2.875rem] md:contents">
        {job.models.map((jm) => {
          const m = run.models.find((x) => x.id === jm.id);
          return (
            <div key={jm.id} className={cx('min-w-0 items-baseline justify-between gap-2 md:block', m ? 'flex' : 'hidden')}>
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2 md:hidden">
                <ModelDot color={jm.color} size={7} />
                <span className="truncate">{jm.label}</span>
              </span>
              <Score m={m} />
            </div>
          );
        })}
      </div>
      <div className="hidden text-right md:block">
        {live ? (
          <>
            <div className="num text-[13px] font-semibold text-accent">
              {run.progress.finished}/{run.progress.total}
            </div>
            <div className="mt-1.5 ml-auto h-1 w-20 overflow-hidden rounded-full bg-ink/[0.07]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="text-[13px] text-ink-2">{ago(run.created_at, now)}</div>
            <div className="num mt-0.5 text-[12px] text-faint">{duration(run.started_at, run.finished_at, now)}</div>
          </>
        )}
      </div>
    </Link>
  );
}

/** One job's runs as a ledger: a model's column read downwards is its history on this job. */
function JobRuns({ job, first, now }: { job: Job; first: boolean; now: number }) {
  const cols = { '--cols': `minmax(0, 1.9fr) repeat(${job.models.length}, minmax(0, 1fr)) 92px` } as CSSProperties;
  return (
    <section className={cx('border-t-2 border-ink pt-6', !first && 'mt-16')} style={cols}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[19px] leading-[1.25] font-bold tracking-[-0.015em]">{job.title}</h2>
        <Link href={`/verdict/${job.id}`} className="link inline-flex items-center gap-1 text-[13.5px]">
          The verdict <ArrowRight size={14} />
        </Link>
      </div>
      <p className="mt-1 text-[13.5px] text-muted">
        {plural(job.runs.length, 'run')} · {plural(job.runs[0].tasks, 'task')} · {plural(job.models.length, 'model')}
      </p>
      <div className="mt-6 hidden items-end gap-x-6 pb-2.5 md:grid md:[grid-template-columns:var(--cols)]">
        <span className="label">Run</span>
        {job.models.map((m) => (
          <span key={m.id} className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <ModelDot color={m.color} size={8} />
            <span className="truncate">{m.label}</span>
          </span>
        ))}
        <span className="label text-right">Started</span>
      </div>
      <div className="mt-5 md:mt-0">
        {job.runs.map((r) => (
          <Row key={r.id} run={r} job={job} now={now} />
        ))}
      </div>
    </section>
  );
}

export function Runs() {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const q = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.get<RunListItem[]>('/runs'),
    refetchInterval: (query) => (query.state.data?.some((r) => r.active) ? 1_500 : 10_000),
  });
  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="A run sends every task of a job to every model you choose and grades the answers as they arrive. The figures are tasks passed."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Play size={15} /> New run
          </button>
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && q.data.length === 0 && (
        <div className="border-t-2 border-ink">
          <Empty
            icon={<Play size={18} />}
            title="No runs yet"
            action={
              <button className="btn-primary" onClick={() => setOpen(true)}>
                Start the first run
              </button>
            }
          >
            Pick a suite and a few models. Answers are graded by the suite's checks as soon as they come back.
          </Empty>
        </div>
      )}
      {q.data && byJob(q.data).map((job, i) => <JobRuns key={job.id} job={job} first={i === 0} now={now} />)}
      <NewRunModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
