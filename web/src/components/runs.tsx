import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type Model, type SuiteSummary } from '../api';
import { cx, ErrorNote, Field, ModelDot, Modal } from './ui';

export function NewRunModal({ open, onClose, suiteId }: { open: boolean; onClose: () => void; suiteId?: string }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const suites = useQuery({ queryKey: ['suites'], queryFn: () => api.get<SuiteSummary[]>('/suites'), enabled: open });
  const models = useQuery({ queryKey: ['models'], queryFn: () => api.get<Model[]>('/models'), enabled: open });
  const [suite, setSuite] = useState(suiteId ?? '');
  const [chosen, setChosen] = useState<number[]>([]);
  const [label, setLabel] = useState('');

  useEffect(() => {
    // Without a suite to start from, offer the one that was run last: it is the job in hand.
    const latest = [...(suites.data ?? [])].sort((a, b) => (b.last_run?.created_at ?? '').localeCompare(a.last_run?.created_at ?? ''))[0];
    if (!suite && latest) setSuite(suiteId ?? latest.id);
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
                    'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-ink bg-ink/[0.03]' : 'border-line-2 hover:bg-ink/[0.03]',
                  )}
                >
                  <span className={cx('grid h-4 w-4 place-items-center rounded-[5px] border', on ? 'border-ink bg-ink text-panel' : 'border-line-2')}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <ModelDot color={m.color} />
                  <span className="min-w-0 flex-[1_1_8rem]">
                    <span className="block truncate text-[14.5px] font-semibold text-ink">{m.label}</span>
                    <span className="block truncate font-mono text-[11.5px] text-faint">{m.model}</span>
                  </span>
                  {/* On a phone the warning drops under the name, lined up with it. */}
                  {!m.key.present && (
                    <span className="chip bg-warn-tint text-warn max-sm:ml-[3.0625rem]">
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
