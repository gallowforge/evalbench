import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { api, type Result, type RunDetail, type TaskAnswers } from '../api';
import { Markdown, Raw } from '../components/Markdown';
import { cx, ErrorNote, Loading, ModelDot, PageHeader, Segmented } from '../components/ui';
import { compact, ms } from '../lib/format';

function dotFor(r?: Result) {
  if (!r || r.status !== 'done') return 'bg-white/15';
  if (r.passed === null) return 'bg-white/30';
  if (r.passed) return 'bg-good';
  return (r.score ?? 0) > 0 ? 'bg-warn' : 'bg-bad';
}

export function Compare({ runId, taskId }: { runId: number; taskId: string }) {
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [showPrompt, setShowPrompt] = useState(true);
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.get<RunDetail>(`/runs/${runId}`) });
  const q = useQuery({ queryKey: ['answers', runId, taskId], queryFn: () => api.get<TaskAnswers>(`/runs/${runId}/tasks/${taskId}`) });

  if (run.isLoading || q.isLoading) return <Loading />;
  if (run.error || q.error) return <ErrorNote error={run.error ?? q.error} />;
  const r = run.data!;
  const { task, answers } = q.data!;
  const byKey = new Map(r.results.map((x) => [`${x.task_id}:${x.model_id}`, x]));
  const modelOf = (id: number) => r.models.find((m) => m.id === id)!;

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <Link href={`/runs/${runId}`} className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
            <ArrowLeft size={14} /> Run #{runId}
          </Link>
          <div className="card max-h-[calc(100vh-120px)] overflow-y-auto p-2">
            {r.categories.map((cat) => (
              <div key={cat} className="mb-1">
                <div className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{cat}</div>
                {r.tasks
                  .filter((t) => t.category === cat)
                  .map((t) => (
                    <Link
                      key={t.id}
                      href={`/runs/${runId}/tasks/${t.id}`}
                      className={cx(
                        'flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12.5px] transition-colors',
                        t.id === taskId ? 'bg-white/[0.07] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink-2',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="flex gap-[3px]">
                        {r.models.map((m) => (
                          <span key={m.id} className={cx('h-[7px] w-[7px] rounded-full', dotFor(byKey.get(`${t.id}:${m.id}`)))} />
                        ))}
                      </span>
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <span className="chip capitalize">{task.category}</span>
              <span className="font-mono text-[12px] text-faint">{task.id}</span>
            </span>
          }
          title={task.title || task.id}
          actions={
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'rendered', label: 'Rendered' },
                { value: 'raw', label: 'Raw' },
              ]}
            />
          }
        />

        <div className="card mb-5">
          <button type="button" className="flex w-full items-center justify-between px-5 py-3.5 text-left" onClick={() => setShowPrompt((s) => !s)}>
            <span className="label">Prompt</span>
            <ChevronDown size={15} className={cx('text-muted transition-transform', showPrompt && 'rotate-180')} />
          </button>
          {showPrompt && (
            <div className="border-t border-line px-5 py-4">
              {task.system && (
                <div className="mb-3 rounded-[9px] border border-line bg-white/[0.02] px-3 py-2 text-[12.5px] text-muted">
                  <span className="font-semibold text-ink-2">System:</span> {task.system}
                </div>
              )}
              <Markdown text={task.prompt} />
              {task.reference && (
                <div className="mt-4 rounded-[9px] border border-good/20 bg-good/[0.05] px-3 py-2 text-[12.5px] text-ink-2">
                  <span className="font-semibold text-good-ink">Reference:</span> {task.reference}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${answers.length > 3 ? 280 : 320}px, 1fr))` }}>
          {answers.map((a) => {
            const m = modelOf(a.model_id);
            return (
              <article key={a.id} className="card relative flex min-w-0 flex-col overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: m.color }} />
                <header className="border-b border-line px-4 pb-3 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <ModelDot color={m.color} />
                      <span className="truncate text-[13.5px] font-semibold">{m.label}</span>
                    </span>
                    <span className="num shrink-0 text-[11.5px] text-faint">
                      {ms(a.latency_ms)} · {compact(a.output_tokens)} tok
                    </span>
                  </div>
                  {a.checks.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {a.checks.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-[12px]" title={c.detail}>
                          <span
                            className={cx(
                              'mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full',
                              c.passed ? 'bg-good/20 text-good-ink' : 'bg-bad/20 text-bad-ink',
                            )}
                          >
                            {c.passed ? <Check size={10} strokeWidth={3.2} /> : <X size={10} strokeWidth={3.2} />}
                          </span>
                          <span className="min-w-0">
                            <span className="text-ink-2">{c.label}</span>
                            <span className="text-faint"> · {c.detail}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </header>
                <div className="flex-1 px-4 py-4">
                  {a.status === 'error' ? (
                    <div className="flex items-start gap-2 text-[13px] text-serious">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {a.error}
                    </div>
                  ) : a.status !== 'done' ? (
                    <div className="text-[13px] text-muted">Waiting for the answer…</div>
                  ) : view === 'raw' ? (
                    <Raw text={a.output ?? ''} />
                  ) : (
                    <Markdown text={a.output ?? ''} />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
