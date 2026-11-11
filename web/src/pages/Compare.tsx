import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { api, type Result, type RunDetail, type TaskAnswers } from '../api';
import { Answer, Markdown, Raw } from '../components/Markdown';
import { cx, ErrorNote, isNotFound, Loading, ModelDot, NotFound, Segmented } from '../components/ui';
import { compact, ms } from '../lib/format';

/** Passing is the quiet case; only what failed takes the red. */
function dotFor(r?: Result) {
  if (!r || r.status !== 'done') return 'border border-ink/25';
  if (r.passed === null || r.passed) return 'bg-ink/25';
  return (r.score ?? 0) > 0 ? 'bg-warn' : 'bg-mark';
}

function outcome(r?: Result): { word: string; cls: string } | null {
  if (!r || r.status !== 'done' || r.passed === null) return null;
  if (r.passed) return { word: 'Passed', cls: 'text-muted' };
  return (r.score ?? 0) > 0 ? { word: 'Partly right', cls: 'font-semibold text-warn' } : { word: 'Failed', cls: 'font-semibold text-mark-ink' };
}

export function Compare({ runId, taskId }: { runId: number; taskId: string }) {
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [showPrompt, setShowPrompt] = useState(true);
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api.get<RunDetail>(`/runs/${runId}`) });
  const q = useQuery({ queryKey: ['answers', runId, taskId], queryFn: () => api.get<TaskAnswers>(`/runs/${runId}/tasks/${taskId}`) });

  if (run.isLoading || q.isLoading) return <Loading />;
  if (isNotFound(run.error)) return <NotFound what="run" href="/runs" back="All runs" />;
  if (isNotFound(q.error)) return <NotFound what="task in this run" href={`/runs/${runId}`} back={`Back to run ${runId}`} />;
  if (run.error || q.error) return <ErrorNote error={run.error ?? q.error} />;
  const r = run.data!;
  const { task, answers } = q.data!;
  const byKey = new Map(r.results.map((x) => [`${x.task_id}:${x.model_id}`, x]));
  const modelOf = (id: number) => r.models.find((m) => m.id === id)!;

  return (
    <div className="grid gap-10 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <Link href={`/runs/${runId}`} className="mb-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-ink">
            <ArrowLeft size={15} /> Run {runId}
          </Link>
          <nav className="max-h-[calc(100vh-150px)] overflow-y-auto pr-2">
            {r.categories.map((cat) => (
              <div key={cat} className="mb-4">
                <div className="mb-1 px-2.5 text-[12.5px] font-semibold capitalize text-faint">{cat}</div>
                {r.tasks
                  .filter((t) => t.category === cat)
                  .map((t) => (
                    <Link
                      key={t.id}
                      href={`/runs/${runId}/tasks/${t.id}`}
                      className={cx(
                        'flex items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-[13.5px] transition-colors',
                        t.id === taskId ? 'bg-ink/[0.08] font-semibold text-ink' : 'text-ink-2 hover:bg-ink/[0.04]',
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
          </nav>
        </div>
      </aside>

      <div className="min-w-0">
        <Link href={`/runs/${runId}`} className="mb-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-ink lg:hidden">
          <ArrowLeft size={15} /> Run {runId}
        </Link>
        <div className="mb-3 flex items-baseline gap-2.5">
          <span className="text-[13.5px] font-semibold capitalize text-muted">{task.category}</span>
          <span className="font-mono text-[12.5px] text-faint">{task.id}</span>
        </div>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[34px] leading-[1.04] font-bold tracking-[-0.035em] md:text-[42px]">{task.title || task.id}</h1>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'rendered', label: 'Rendered' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
        </div>

        <div className="mb-10 border-l-[3px] border-ink/15 pl-5">
          <button
            type="button"
            className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"
            onClick={() => setShowPrompt((s) => !s)}
          >
            The prompt <ChevronDown size={14} className={cx('transition-transform', showPrompt && 'rotate-180')} />
          </button>
          {showPrompt && (
            <>
              {/* The system prompt is long and the same for a whole job, so it waits behind its label. */}
              {task.system && (
                <details className="mb-3 max-w-[86ch] text-[13.5px] text-muted">
                  <summary className="cursor-pointer font-semibold text-ink-2 hover:text-ink">System prompt</summary>
                  <div className="mt-2 leading-relaxed whitespace-pre-wrap">{task.system}</div>
                </details>
              )}
              <div className="max-w-[86ch]">
                <Markdown text={task.prompt} className="prose-answer text-[15.5px] text-ink" />
              </div>
              {task.reference && (
                <div className="mt-4 max-w-[86ch] text-[14px] text-ink-2">
                  <span className="font-semibold text-ink">Reference answer: </span>
                  {task.reference}
                </div>
              )}
            </>
          )}
        </div>

        {/* One answer under another, each with its model and its checks in the margin: any number of
            models reads the same way, and the answers keep a line length worth reading. */}
        <div>
          {answers.map((a, i) => {
            const m = modelOf(a.model_id);
            const out = outcome(byKey.get(`${task.id}:${a.model_id}`));
            return (
              <article
                key={a.id}
                className={cx(
                  'grid min-w-0 gap-x-10 gap-y-5 py-8 md:grid-cols-[230px_minmax(0,1fr)]',
                  i === 0 ? 'border-t-2 border-ink' : 'border-t border-line',
                )}
              >
                <header className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ModelDot color={m.color} size={10} />
                    <span className="truncate text-[16.5px] font-semibold tracking-[-0.01em]">{m.label}</span>
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-muted">
                    {out && <span className={out.cls}>{out.word} · </span>}
                    {ms(a.latency_ms)} · {compact(a.output_tokens)} tokens
                  </div>
                  {a.checks.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {a.checks.map((c, j) => (
                        <li key={j} className="flex items-start gap-2 text-[13px] leading-snug" title={c.detail}>
                          {c.passed ? (
                            <Check size={14} strokeWidth={2.6} className="mt-[2px] shrink-0 text-faint" />
                          ) : (
                            <X size={14} strokeWidth={3} className="mt-[2px] shrink-0 text-mark-ink" />
                          )}
                          <span className="min-w-0">
                            <span className={cx('font-semibold', c.passed ? 'text-ink-2' : 'text-mark-ink')}>{c.label}</span>
                            <span className="block text-muted">{c.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </header>
                <div className="min-w-0 max-w-[78ch]">
                  {a.status === 'error' ? (
                    <div className="flex items-start gap-2 text-[14px] text-serious">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {a.error}
                    </div>
                  ) : a.status !== 'done' ? (
                    <div className="text-[14px] text-muted">Waiting for the answer…</div>
                  ) : view === 'raw' ? (
                    <Raw text={a.output ?? ''} />
                  ) : (
                    <Answer text={a.output ?? ''} />
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
