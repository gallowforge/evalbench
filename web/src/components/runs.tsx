import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type Model, type RunListItem, type SuiteSummary } from '../api';
import { ago, duration, pct } from '../lib/format';
import { useNow } from '../lib/hooks';
import { cx, ErrorNote, Field, ModelDot, Modal, StatusPill } from './ui';
import { tone } from '../lib/theme';

export function RunRow({ run }: { run: RunListItem; compact?: boolean }) {
  const now = useNow();
  const live = run.active || run.status === 'running';
  const progress = run.progress.total ? run.progress.finished / run.progress.total : 0;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-3 rounded-[12px] px-5 py-4 transition-colors hover:bg-ink/[0.035] md:grid-cols-[230px_minmax(0,1fr)_110px]"
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <span className="slab text-[20px] leading-none font-semibold text-faint">#{run.id}</span>
          <span className="truncate text-[15px] font-semibold text-ink">{run.label || run.suite_title}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2.5 text-[13px] text-muted">
          <StatusPill status={run.status} />
          <span className="truncate">{run.label ? run.suite_title : `${run.tasks} tasks`}</span>
        </div>
      </div>
      <div className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-3 md:col-span-1 lg:grid-cols-4">
        {run.models.map((m) => (
          <div key={m.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
                <ModelDot color={m.color} size={7} />
                <span className="truncate">{m.label}</span>
              </span>
              <span className="slab text-[17px] leading-none font-semibold text-ink">{pct(m.pass_rate)}</span>
            </div>
            <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-ink/[0.07]">
              <div className="h-full rounded-full" style={{ width: `${(m.pass_rate ?? 0) * 100}%`, background: tone(m.color) }} />
            </div>
          </div>
        ))}
      </div>
      <div className="col-start-2 row-start-1 text-right md:col-auto md:row-auto">
        {live ? (
          <div className="ml-auto w-28">
            <div className="num text-[13px] font-semibold text-accent">
              {run.progress.finished}/{run.progress.total}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
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
            <span className="text-[13.5px] font-semibold text-ink-2">Models</span>
            {models.data && models.data.length > 1 && (
              <button
                className="link text-[13px]"
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
                    on ? 'border-ink bg-ink/[0.03]' : 'border-line-2 hover:bg-ink/[0.03]',
                  )}
                >
                  <span className={cx('grid h-4 w-4 place-items-center rounded-[5px] border', on ? 'border-ink bg-ink text-panel' : 'border-line-2')}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <ModelDot color={m.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold text-ink">{m.label}</span>
                    <span className="block truncate font-mono text-[11.5px] text-faint">{m.model}</span>
                  </span>
                  {!m.key.present && (
                    <span className="chip bg-warn-tint text-warn">
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
