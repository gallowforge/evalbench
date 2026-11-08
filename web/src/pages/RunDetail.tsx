import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, RotateCcw, Scale, Square } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type Result, type RunDetail } from '../api';
import { Card, ErrorNote, Loading, ModelDot, PageHeader, ResultCell, StatusPill } from '../components/ui';
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
  if (q.error) return <ErrorNote error={q.error} />;
  const run = q.data!;
  const byKey = new Map<string, Result>(run.results.map((r) => [`${r.task_id}:${r.model_id}`, r]));
  const live = run.active;
  const progress = run.progress.total ? run.progress.finished / run.progress.total : 0;
  const errors = run.results.filter((r) => r.status === 'error').length;
  const resumable = !live && (run.status === 'interrupted' || run.status === 'cancelled' || errors > 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/runs" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft size={14} /> Runs
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {run.suite_title}
            <span className="num text-[18px] font-normal text-faint">#{run.id}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill status={run.status} />
            {run.label && <span className="chip">{run.label}</span>}
            <span>
              {plural(run.tasks.length, 'task')} × {plural(run.models.length, 'model')}
            </span>
            <span className="text-faint">·</span>
            <span>started {ago(run.started_at ?? run.created_at, now)}</span>
            <span className="text-faint">·</span>
            <span className="num">{duration(run.started_at, run.finished_at, now)}</span>
          </span>
        }
        actions={
          <>
            {live && (
              <button className="btn-ghost" onClick={() => action.mutate('cancel')}>
                <Square size={13} /> Cancel
              </button>
            )}
            {resumable && (
              <button className="btn-ghost" onClick={() => action.mutate('resume')}>
                <RotateCcw size={14} /> {errors ? `Retry ${errors} failed` : 'Resume'}
              </button>
            )}
            <a className="btn-ghost" href={`/api/export/results.jsonl?run=${run.id}`}>
              <Download size={14} /> Results
            </a>
            {run.models.length > 1 && (
              <Link href={`/rate?run=${run.id}`} className="btn-primary">
                <Scale size={15} /> Rate blind{run.rating.total ? ` · ${run.rating.total} pairs` : ''}
              </Link>
            )}
          </>
        }
      />

      {live && (
        <div className="card mb-5 flex items-center gap-4 px-5 py-3.5">
          <span className="text-[13px] text-accent">Running</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="num text-[12.5px] text-muted">
            {run.progress.finished} of {run.progress.total} answers
          </span>
        </div>
      )}
      <ErrorNote error={action.error} />

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}>
        {run.models.map((m) => {
          const s = m.summary;
          return (
            <div key={m.id} className="card relative overflow-hidden p-5">
              <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: m.color }} />
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <ModelDot color={m.color} />
                <span className="truncate">{m.label}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="slab text-[40px] font-bold leading-none">{pct(s.pass_rate)}</span>
                <span className="num text-[12.5px] text-muted">
                  {s.passed}/{s.attempted} passed
                </span>
              </div>
              <div className="mt-4 space-y-1.5">
                {run.categories.map((c) => (
                  <div key={c} className="flex items-center gap-2.5 text-[11.5px]">
                    <span className="w-[74px] shrink-0 capitalize text-muted">{c}</span>
                    <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full" style={{ width: `${(s.categories[c] ?? 0) * 100}%`, background: m.color }} />
                    </div>
                    <span className="num w-8 text-right text-ink-2">{pct(s.categories[c])}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-4 border-t border-line pt-3 text-[11.5px] text-muted">
                <span>
                  <span className="num text-ink-2">{ms(s.latency_ms)}</span> median
                </span>
                <span>
                  <span className="num text-ink-2">{compact(s.output_tokens)}</span> tokens
                </span>
                {s.errors > 0 && <span className="text-serious">{s.errors} errors</span>}
              </div>
            </div>
          );
        })}
      </div>

      <Card className="mt-5" title="Results" action={<span className="text-[12px] text-faint">Click a cell to compare answers side by side</span>}>
        <div className="overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: '6px 4px' }}>
            <thead>
              <tr>
                <th className="text-left text-[11px] font-medium uppercase tracking-[0.07em] text-faint">Task</th>
                {run.models.map((m) => (
                  <th key={m.id} className="min-w-[96px] pb-1 text-[12px] font-medium text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <ModelDot color={m.color} size={6} />
                      {m.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.categories.map((cat) => (
                <Fragment key={cat}>
                  <tr>
                    <td colSpan={run.models.length + 1} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {cat}
                    </td>
                  </tr>
                  {run.tasks
                    .filter((t) => t.category === cat)
                    .map((t) => (
                      <tr key={t.id}>
                        <td className="max-w-[340px] pr-3">
                          <Link href={`/runs/${run.id}/tasks/${t.id}`} className="block truncate text-[13px] text-ink-2 hover:text-ink">
                            {t.title}
                            <span className="ml-2 font-mono text-[11px] text-faint">{t.id}</span>
                          </Link>
                        </td>
                        {run.models.map((m) => (
                          <td key={m.id}>
                            <ResultCell result={byKey.get(`${t.id}:${m.id}`)} onClick={() => navigate(`/runs/${run.id}/tasks/${t.id}`)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
