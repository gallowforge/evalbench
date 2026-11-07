import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type Model, type RunListItem, type SuiteSummary } from '../api';
import { ago, duration, pct } from '../lib/format';
import { useNow } from '../lib/hooks';
import { cx, ErrorNote, Field, ModelDot, Modal, StatusPill } from './ui';

export function RunRow({ run, compact = false }: { run: RunListItem; compact?: boolean }) {
  const now = useNow();
  const live = run.active || run.status === 'running';
  const progress = run.progress.total ? run.progress.finished / run.progress.total : 0;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 rounded-[12px] px-4 py-3.5 transition-colors hover:bg-white/[0.03] md:grid-cols-[200px_minmax(0,1fr)_120px]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="num text-[12px] text-faint">#{run.id}</span>
          <span className="truncate text-[13.5px] font-medium text-ink">{run.suite_title}</span>
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-[12px] text-muted">
          <StatusPill status={run.status} />
          {run.label && <span className="truncate">· {run.label}</span>}
        </div>
      </div>
      <div className={cx('col-span-2 md:col-span-1 grid gap-x-5 gap-y-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4 gap-x-6')}>
        {run.models.map((m) => (
          <div key={m.id} className="min-w-0">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                <ModelDot color={m.color} size={6} />
                <span className="truncate">{m.label}</span>
              </span>
              <span className="num font-semibold text-ink">{pct(m.pass_rate)}</span>
            </div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full" style={{ width: `${(m.pass_rate ?? 0) * 100}%`, background: m.color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="row-start-1 col-start-2 md:row-auto md:col-auto text-right">
        {live ? (
          <div className="w-28">
            <div className="num text-[12px] text-accent">
              {run.progress.finished}/{run.progress.total}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        ) : (
          <>
            <div className="text-[12px] text-ink-2">{ago(run.created_at, now)}</div>
            <div className="num mt-0.5 text-[11.5px] text-faint">{duration(run.started_at, run.finished_at, now)}</div>
          </>
        )}
      </div>
    </Link>
  );
}

export function NewRunModal({ open, onClose, suiteId }: { open: boolean; onClose: () => void; suiteId?: string }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const suites = useQuery({ queryKey: ['suites'], queryFn: () => api.get<SuiteSummary[]>('/suites'), enabled: open });
  const models = useQuery({ queryKey: ['models'], queryFn: () => api.get<Model[]>('/models'), enabled: open });
  const [suite, setSuite] = useState(suiteId ?? '');
  const [chosen, setChosen] = useState<number[]>([]);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!suite && suites.data?.length) setSuite(suiteId ?? suites.data[0].id);
  }, [suites.data, suite, suiteId]);

  const start = useMutation({
    mutationFn: () => api.post<{ id: number }>('/runs', { suite_id: suite, model_ids: chosen, label }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      onClose();
      navigate(`/runs/${id}`);
    },
  });

  const selected = suites.data?.find((s) => s.id === suite);
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const calls = (selected?.tasks ?? 0) * chosen.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New run"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!suite || !chosen.length || start.isPending} onClick={() => start.mutate()}>
            Start {calls ? `· ${calls} answers` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Suite">
          <select className="input" value={suite} onChange={(e) => setSuite(e.target.value)}>
            {suites.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {s.tasks} tasks
              </option>
            ))}
          </select>
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-ink-2">Models</span>
            {models.data && models.data.length > 1 && (
              <button
                className="text-[12px] text-accent"
                onClick={() => setChosen(chosen.length === models.data!.length ? [] : models.data!.map((m) => m.id))}
              >
                {chosen.length === models.data.length ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {models.data?.length === 0 && (
            <div className="rounded-[10px] border border-dashed border-line-2 px-4 py-5 text-center text-[13px] text-muted">
              No models yet.{' '}
              <Link href="/models" className="text-accent" onClick={onClose}>
                Add one first
              </Link>
              .
            </div>
          )}
          <div className="grid gap-1.5">
            {models.data?.map((m) => {
              const on = chosen.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cx(
                    'flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-accent/50 bg-accent/[0.07]' : 'border-line-2 hover:bg-white/[0.03]',
                  )}
                >
                  <span
                    className={cx(
                      'grid h-4 w-4 place-items-center rounded-[5px] border',
                      on ? 'border-accent bg-accent text-accent-ink' : 'border-line-2',
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <ModelDot color={m.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{m.label}</span>
                    <span className="block truncate font-mono text-[11.5px] text-faint">{m.model}</span>
                  </span>
                  {!m.key.present && (
                    <span className="chip border-warn/30 text-warn">
                      <KeyRound size={11} /> {m.key.env} missing
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Label" hint="Optional. Shows on the run list and in the history chart.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. new system prompt" />
        </Field>
        <ErrorNote error={start.error} />
      </div>
    </Modal>
  );
}
