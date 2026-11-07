import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CheckCircle2, KeyRound, Pencil, Plus, Radar, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Model, type Preset, type Provider } from '../api';
import { cx, Empty, ErrorNote, Field, Loading, Modal, ModelDot, PageHeader } from '../components/ui';
import { useMeta } from '../lib/hooks';

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', 'openai-compatible': 'OpenAI-compatible' };

function providerName(m: Model): string {
  if (m.provider !== 'openai-compatible' || !m.base_url) return PROVIDER_LABEL[m.provider];
  if (/:1234(\/|$)/.test(m.base_url)) return 'LM Studio';
  if (/:11434(\/|$)/.test(m.base_url)) return 'Ollama';
  return PROVIDER_LABEL[m.provider];
}

interface Draft {
  label: string;
  provider: Provider;
  base_url: string;
  model: string;
  api_key_env: string;
  max_tokens: string;
  temperature: string;
  effort: string;
  concurrency: string;
}

const emptyDraft = (p?: Preset): Draft => ({
  label: '',
  provider: p?.provider ?? 'openai-compatible',
  base_url: p?.base_url ?? '',
  model: '',
  api_key_env: '',
  max_tokens: '',
  temperature: '',
  effort: '',
  concurrency: String(p?.concurrency ?? 2),
});

function fromModel(m: Model): Draft {
  return {
    label: m.label,
    provider: m.provider,
    base_url: m.base_url ?? '',
    model: m.model,
    api_key_env: m.api_key_env ?? '',
    max_tokens: m.params.max_tokens ? String(m.params.max_tokens) : '',
    temperature: m.params.temperature !== undefined ? String(m.params.temperature) : '',
    effort: m.params.effort ?? '',
    concurrency: String(m.concurrency),
  };
}

function ModelForm({ initial, editing, onClose }: { initial?: Model; editing: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const presets = meta.data?.presets ?? [];
  const [preset, setPreset] = useState<string>(initial ? '' : 'lmstudio');
  const [d, setD] = useState<Draft>(initial ? fromModel(initial) : emptyDraft(presets.find((p) => p.id === 'lmstudio')));
  const [found, setFound] = useState<string[] | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const info = meta.data?.providers?.[d.provider];
  const keyEnv = d.api_key_env || info?.key_env || null;

  useEffect(() => {
    if (!initial && presets.length && preset) {
      const p = presets.find((x) => x.id === preset);
      if (p) setD((x) => ({ ...emptyDraft(p), label: x.label, model: x.provider === p.provider ? x.model : '' }));
      setFound(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, presets.length]);

  const discover = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; models: string[]; error?: string }>('/models/discover', {
        provider: d.provider,
        base_url: d.base_url,
        api_key_env: d.api_key_env,
      }),
    onSuccess: (r) => setFound(r.ok ? r.models : []),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: d.label || d.model,
        provider: d.provider,
        base_url: d.base_url,
        model: d.model,
        api_key_env: d.api_key_env,
        concurrency: Number(d.concurrency) || 1,
        params: { max_tokens: d.max_tokens, temperature: d.temperature, effort: d.effort },
      };
      return editing && initial ? api.put(`/models/${initial.id}`, body) : api.post('/models', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${initial?.label}` : 'Add a model'}
      width={620}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!d.model || save.isPending} onClick={() => save.mutate()}>
            {editing ? 'Save' : 'Add model'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {!editing && (
          <div className="grid grid-cols-5 gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={cx(
                  'rounded-[10px] border px-2 py-2.5 text-[12px] font-medium transition-colors',
                  preset === p.id ? 'border-accent/60 bg-accent/[0.08] text-ink' : 'border-line-2 text-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {d.provider !== 'anthropic' && d.provider !== 'openai' && (
          <Field label="Base URL" hint="From inside Docker, your machine is host.docker.internal.">
            <div className="flex gap-2">
              <input
                className="input font-mono text-[12.5px]"
                value={d.base_url}
                onChange={(e) => set({ base_url: e.target.value })}
                placeholder="http://host.docker.internal:1234/v1"
              />
              <button className="btn-ghost shrink-0" onClick={() => discover.mutate()} disabled={!d.base_url || discover.isPending}>
                <Radar size={14} /> Find models
              </button>
            </div>
          </Field>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Model id">
            <input
              className="input font-mono text-[12.5px]"
              list="found-models"
              value={d.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder={d.provider === 'anthropic' ? 'claude-opus-5-5' : 'qwen3-8b'}
            />
            <datalist id="found-models">
              {(found ?? info?.suggested ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Display name">
            <input className="input" value={d.label} onChange={(e) => set({ label: e.target.value })} placeholder={d.model || 'Optional'} />
          </Field>
        </div>
        {(found || discover.data?.error) && (
          <div className="text-[12.5px]">
            {discover.data?.error ? (
              <span className="text-bad-ink">{discover.data.error}</span>
            ) : found && found.length ? (
              <div className="flex flex-wrap gap-1.5">
                {found.slice(0, 18).map((m) => (
                  <button
                    key={m}
                    className={cx('chip font-mono text-[11.5px]', d.model === m && 'border-accent/60 text-ink')}
                    onClick={() => set({ model: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-muted">The server is up but lists no models. Load one in LM Studio or pull one in Ollama.</span>
            )}
          </div>
        )}
        <Field
          label="API key variable"
          hint={
            keyEnv ? (
              <>
                Evalbench reads the key from <span className="font-mono text-ink-2">{keyEnv}</span> in its environment and never stores it.
              </>
            ) : (
              'Local servers usually need no key. Name an environment variable here if yours does.'
            )
          }
        >
          <input
            className="input font-mono text-[12.5px]"
            value={d.api_key_env}
            onChange={(e) => set({ api_key_env: e.target.value })}
            placeholder={info?.key_env ?? 'none'}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Max tokens">
            <input
              className="input num"
              type="number"
              value={d.max_tokens}
              onChange={(e) => set({ max_tokens: e.target.value })}
              placeholder={String(info?.max_tokens ?? '')}
            />
          </Field>
          {d.provider !== 'anthropic' ? (
            <Field label="Temperature">
              <input
                className="input num"
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={d.temperature}
                onChange={(e) => set({ temperature: e.target.value })}
                placeholder="default"
              />
            </Field>
          ) : (
            <div />
          )}
          {d.provider !== 'openai-compatible' ? (
            <Field label="Effort">
              <select className="input" value={d.effort} onChange={(e) => set({ effort: e.target.value })}>
                <option value="">default</option>
                {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          ) : (
            <div />
          )}
          <Field label="Parallel requests">
            <input
              className="input num"
              type="number"
              min={1}
              max={32}
              value={d.concurrency}
              onChange={(e) => set({ concurrency: e.target.value })}
            />
          </Field>
        </div>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

function ModelCard({ m, onEdit }: { m: Model; onEdit: () => void }) {
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; found?: boolean; ms?: number; detail?: string; error?: string }>(`/models/${m.id}/test`),
  });
  const remove = useMutation({ mutationFn: () => api.del(`/models/${m.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['models'] }) });
  const r = test.data;
  return (
    <div className="card relative flex flex-col overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: m.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ModelDot color={m.color} />
            <span className="truncate text-[15px] font-semibold">{m.label}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[12px] text-muted">{m.model}</div>
        </div>
        <span className="chip shrink-0">{providerName(m)}</span>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-faint">Endpoint</dt>
        <dd className="truncate font-mono text-[11.5px] text-ink-2">
          {m.base_url ?? (m.provider === 'anthropic' ? 'api.anthropic.com' : 'api.openai.com')}
        </dd>
        <dt className="text-faint">Key</dt>
        <dd>
          {m.key.env ? (
            <span className={cx('inline-flex items-center gap-1.5 font-mono text-[11.5px]', m.key.present ? 'text-good-ink' : 'text-warn')}>
              <KeyRound size={12} /> {m.key.env} {m.key.present ? 'set' : 'not set'}
            </span>
          ) : (
            <span className="text-ink-2">none needed</span>
          )}
        </dd>
        <dt className="text-faint">Settings</dt>
        <dd className="text-ink-2">
          {[
            m.params.temperature !== undefined ? `temperature ${m.params.temperature}` : null,
            m.params.effort ? `effort ${m.params.effort}` : null,
            m.params.max_tokens ? `${m.params.max_tokens.toLocaleString()} max tokens` : null,
            `${m.concurrency} parallel`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </dd>
      </dl>
      {r && (
        <div
          className={cx(
            'mt-4 flex items-start gap-2 rounded-[9px] px-3 py-2 text-[12.5px]',
            r.ok && r.found ? 'bg-good/[0.09] text-good-ink' : 'bg-warn/[0.09] text-warn',
          )}
        >
          {r.ok && r.found ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          <span>{r.ok ? `${r.detail} · ${r.ms} ms` : r.error}</span>
        </div>
      )}
      {test.error && (
        <div className="mt-3">
          <ErrorNote error={test.error} />
        </div>
      )}
      <div className="mt-auto flex items-center gap-1.5 pt-4">
        <button className="btn-ghost h-8 text-[12.5px]" onClick={() => test.mutate()} disabled={test.isPending}>
          <Radar size={14} /> {test.isPending ? 'Testing' : 'Test connection'}
        </button>
        <button className="btn-quiet h-8 text-[12.5px]" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </button>
        <button
          className="btn-quiet ml-auto h-8 w-8 p-0 hover:text-bad-ink"
          title="Remove (archived if it has results)"
          onClick={() => confirm(`Remove ${m.label}? Models with results are archived, not deleted.`) && remove.mutate()}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function Models() {
  const q = useQuery({ queryKey: ['models'], queryFn: () => api.get<Model[]>('/models') });
  const [form, setForm] = useState<{ model?: Model } | null>(null);
  return (
    <>
      <PageHeader
        title="Models"
        subtitle="Local models through LM Studio or Ollama, and API models from Anthropic and OpenAI. Keys are read from environment variables, never stored."
        actions={
          <button className="btn-primary" onClick={() => setForm({})}>
            <Plus size={15} /> Add model
          </button>
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data?.length === 0 && (
        <div className="card">
          <Empty
            icon={<Boxes size={18} />}
            title="No models yet"
            action={
              <button className="btn-primary" onClick={() => setForm({})}>
                Add a model
              </button>
            }
          >
            Point Evalbench at LM Studio or Ollama on this machine, or add an Anthropic or OpenAI model with its key in the environment.
          </Empty>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((m) => (
          <ModelCard key={m.id} m={m} onEdit={() => setForm({ model: m })} />
        ))}
      </div>
      {form && <ModelForm initial={form.model} editing={!!form.model} onClose={() => setForm(null)} />}
    </>
  );
}
