import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Download, RotateCcw, Square } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import { api, download, type Result, type RunDetail } from '../api';
import { cx, ErrorNote, isNotFound, Loading, ModelDot, NotFound, ResultCell, StatusPill } from '../components/ui';
import { ago, compact, duration, ms, pct, plural } from '../lib/format';
import { useNow } from '../lib/hooks';

export function RunDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const now = useNow(5_000);
  const [, navigate] = useLocation();
  const q = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.get<RunDetail>(`/runs/${id}`),
    refetchInterval: (query) => (query.state.data?.active ? 1_000 : false),
  });
  const action = useMutation({
    mutationFn: (what: 'cancel' | 'resume') => api.post(`/runs/${id}/${what}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', id] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (isNotFound(q.error)) return <NotFound what="run" href="/runs" back="All runs" />;
  if (q.error) return <ErrorNote error={q.error} />;
  const run = q.data!;
  const byKey = new Map<string, Result>(run.results.map((r) => [`${r.task_id}:${r.model_id}`, r]));
  const live = run.active;
  const progress = run.progress.total ? run.progress.finished / run.progress.total : 0;
  const errors = run.results.filter((r) => r.status === 'error').length;
  const resumable = !live && (run.status === 'interrupted' || run.status === 'cancelled' || errors > 0);
  const cols = run.models.length;
  // Up to six models share one row on a desk, so no model is left alone on a second line.
  const lgCols = Math.min(cols, 6);

  return (
    <>
      <Link href="/runs" className="mb-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> All runs
      </Link>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <h1 className="text-[34px] leading-[1.04] font-bold tracking-[-0.035em] md:text-[44px]">
            {run.suite_title}, run {run.id}
          </h1>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[14.5px] text-muted">
            <StatusPill status={run.status} />
            {run.label && (
              <span>
                <span className="font-semibold text-ink-2">{run.label}</span>
                <span className="ml-3.5 text-faint">·</span>
              </span>
            )}
            {/* Each dot ends the item before it, so a wrapped line never starts with one. */}
            <span>
              {plural(run.tasks.length, 'task')} × {plural(run.models.length, 'model')}
              <span className="ml-3.5 text-faint">·</span>
            </span>
            <span>
              started {ago(run.started_at ?? run.created_at, now)}
              <span className="ml-3.5 text-faint">·</span>
            </span>
            <span className="num">took {duration(run.started_at, run.finished_at, now)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {live && (
            <button className="btn-ghost" onClick={() => action.mutate('cancel')}>
              <Square size={13} /> Stop
            </button>
          )}
          {resumable && (
            <button className="btn-ghost" onClick={() => action.mutate('resume')}>
              <RotateCcw size={15} /> {errors ? `Retry ${errors} failed` : 'Resume'}
            </button>
          )}
          <a className="btn-ghost" {...download(`/export/results.jsonl?run=${run.id}`)}>
            <Download size={15} /> Results
          </a>
          {run.models.length > 1 && (
            <Link href={`/rate?run=${run.id}`} className="btn-primary">
              Judge {run.rating.total ? plural(run.rating.total, 'pair') : 'blind'} <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </header>

      {live && (
        <div className="mb-8 flex items-center gap-4">
          <span className="text-[14px] font-semibold text-accent">Running</span>
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="num text-[13.5px] text-muted">
            {run.progress.finished} of {run.progress.total} answers
          </span>
        </div>
      )}
      <ErrorNote error={action.error} />

      <section
        className="grid grid-cols-1 border-t-2 border-ink sm:grid-cols-2 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={{ ['--cols' as string]: lgCols }}
      >
        {run.models.map((m, i) => {
          const s = m.summary;
          return (
            <div
              key={m.id}
              className={cx(
                'min-w-0 py-7',
                i > 0 && 'border-t border-line',
                i < 2 ? 'sm:border-t-0' : 'sm:border-t',
                i % 2 === 1 ? 'sm:border-l sm:pl-5' : 'sm:border-l-0 sm:pl-0 sm:pr-5',
                i < lgCols ? 'lg:border-t-0' : 'lg:border-t',
                i % lgCols !== 0 ? 'lg:border-l lg:pl-5' : 'lg:border-l-0 lg:pl-0',
                'lg:pr-5',
              )}
            >
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <ModelDot color={m.color} size={10} />
                <span className="truncate">{m.label}</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2.5">
                <span className={cx('slab leading-[0.85] font-semibold', cols > 4 ? 'text-[44px] xl:text-[50px]' : 'text-[44px] sm:text-[56px]')}>
                  {pct(s.pass_rate)}
                </span>
              </div>
              <div className="mt-2.5 text-[13.5px] text-muted">
                {s.passed} of {s.attempted} tasks passed
                {s.errors > 0 && <span className="text-serious"> · {s.errors} errors</span>}
              </div>
              <div className="mt-5 space-y-2">
                {run.categories.map((c) => (
                  <div key={c} className="grid grid-cols-[minmax(0,5.25rem)_minmax(0,1fr)_2.25rem] items-center gap-2 text-[12.5px]">
                    <span className="truncate capitalize text-muted">{c}</span>
                    <div className="h-[3px] overflow-hidden rounded-full bg-ink/[0.09]">
                      <div className="h-full rounded-full bg-ink" style={{ width: `${(s.categories[c] ?? 0) * 100}%` }} />
                    </div>
                    <span className="num text-right font-semibold text-ink-2">{pct(s.categories[c])}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 text-[12.5px] text-muted">
                <span className="font-semibold text-ink-2">{ms(s.latency_ms)}</span> median ·{' '}
                <span className="num font-semibold text-ink-2">{compact(s.output_tokens)}</span> tokens per answer
              </div>
            </div>
          );
        })}
      </section>

      <section className="border-t border-line pt-9">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[19px] leading-[1.25] font-bold tracking-[-0.015em]">Every answer, graded</h2>
          <span className="text-[13.5px] text-muted">Red failed. Open any mark to read the answers one under another.</span>
        </div>
        <div className="-mx-2 mt-1 overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: '8px 5px' }}>
            <thead>
              <tr>
                <th className="hidden sm:table-cell" />
                {run.models.map((m) => (
                  <th key={m.id} className="pt-3 pb-1 text-[13px] font-semibold text-ink-2 sm:min-w-[96px]">
                    <span className="inline-flex items-center gap-1.5">
                      <ModelDot color={m.color} size={8} />
                      {m.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.categories.map((cat) => (
                <Fragment key={cat}>
                  {/* The name column is hidden on a phone, so the heading spans one column fewer there. */}
                  <tr className="sm:hidden">
                    <td colSpan={cols} className="pt-5 pb-1 text-[12.5px] font-semibold capitalize text-faint">
                      {cat}
                    </td>
                  </tr>
                  <tr className="hidden sm:table-row">
                    <td colSpan={cols + 1} className="pt-5 pb-1 text-[12.5px] font-semibold capitalize text-faint">
                      {cat}
                    </td>
                  </tr>
                  {run.tasks
                    .filter((t) => t.category === cat)
                    .map((t) => {
                      const name = (
                        <Link href={`/runs/${run.id}/tasks/${t.id}`} className="group block truncate text-[14.5px] text-ink-2 hover:text-ink">
                          {t.title}
                          <span className="ml-2 font-mono text-[11.5px] text-faint group-hover:text-muted">{t.id}</span>
                        </Link>
                      );
                      return (
                        <Fragment key={t.id}>
                          {/* On a phone the task's name takes its own line above its verdicts, so all of them fit. */}
                          <tr className="sm:hidden">
                            <td colSpan={cols} className="max-w-0 pt-2">
                              {name}
                            </td>
                          </tr>
                          <tr>
                            <td className="hidden max-w-[360px] pr-4 sm:table-cell">{name}</td>
                            {run.models.map((m) => (
                              <td key={m.id}>
                                <ResultCell result={byKey.get(`${t.id}:${m.id}`)} onClick={() => navigate(`/runs/${run.id}/tasks/${t.id}`)} />
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
