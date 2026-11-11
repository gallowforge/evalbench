import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CheckCircle2, Pencil, Plus, Radar, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Model, type Preset, type Provider } from '../api';
import { cx, Empty, ErrorNote, Field, Loading, Modal, ModelDot, PageHeader } from '../components/ui';
import { useMeta } from '../lib/hooks';
import { money } from '../lib/verdict';

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
  price_in: string;
  price_out: string;
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
  price_in: '',
  price_out: '',
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
    price_in: m.price_in === null || m.price_in === undefined ? '' : String(m.price_in),
    price_out: m.price_out === null || m.price_out === undefined ? '' : String(m.price_out),
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
        price_in: d.price_in,
        price_out: d.price_out,
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
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={cx(
                  'rounded-[10px] border px-2 py-2.5 text-[12px] font-medium transition-colors',
                  preset === p.id ? 'border-ink bg-ink/[0.04] text-ink' : 'border-line-2 text-muted hover:text-ink',
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
                    className={cx('chip font-mono text-[12px]', d.model === m && 'bg-ink text-panel')}
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
        <div className={cx('grid grid-cols-2 gap-4', d.provider === 'openai' ? 'md:grid-cols-4' : 'sm:grid-cols-3')}>
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
          ) : null}
          {d.provider !== 'openai-compatible' ? (
            <Field label="Effort">
              <select className="input" value={d.effort} onChange={(e) => set({ effort: e.target.value })}>
                <option value="">default</option>
                {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          ) : null}
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
        <Field
          label="Price per million tokens, in dollars"
          hint="The verdict uses it to name the cheapest model that is good enough. Enter 0 and 0 for a model you run yourself; leave both empty if you do not know."
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="relative block">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-faint">in</span>
              <input
                className="input num pl-9"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                aria-label="Price per million input tokens"
                value={d.price_in}
                onChange={(e) => set({ price_in: e.target.value })}
                placeholder="3.00"
              />
            </label>
            <label className="relative block">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-faint">out</span>
              <input
                className="input num pl-11"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                aria-label="Price per million output tokens"
                value={d.price_out}
                onChange={(e) => set({ price_out: e.target.value })}
                placeholder="15.00"
              />
            </label>
          </div>
        </Field>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

function ModelRow({ m, first, onEdit }: { m: Model; first: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; found?: boolean; ms?: number; detail?: string; error?: string }>(`/models/${m.id}/test`),
  });
  const remove = useMutation({ mutationFn: () => api.del(`/models/${m.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['models'] }) });
  const r = test.data;
  const settings = [
    m.params.temperature !== undefined ? `temperature ${m.params.temperature}` : null,
    m.params.effort ? `effort ${m.params.effort}` : null,
    m.params.max_tokens ? `${m.params.max_tokens.toLocaleString()} max tokens` : null,
    `${m.concurrency} parallel`,
  ].filter(Boolean);
  const facts = 'grid grid-cols-[4.75rem_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 text-[13.5px]';
  return (
    <div className={cx('py-7', !first && 'border-t border-line')}>
      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <ModelDot color={m.color} size={10} />
            <span className="truncate text-[18px] leading-[1.2] font-bold tracking-[-0.015em]">{m.label}</span>
          </div>
          <div className="mt-1.5 truncate font-mono text-[12px] text-muted">{m.model}</div>
        </div>
        <dl className={facts}>
          <dt className="text-faint">Provider</dt>
          <dd className="text-ink-2">{providerName(m)}</dd>
          <dt className="text-faint">Endpoint</dt>
          <dd className="truncate pt-px font-mono text-[12px] text-ink-2">
            {m.base_url ?? (m.provider === 'anthropic' ? 'api.anthropic.com' : 'api.openai.com')}
          </dd>
          <dt className="text-faint">Key</dt>
          <dd className="min-w-0">
            {m.key.env ? (
              <span className={cx('break-all', m.key.present ? 'text-ink-2' : 'font-semibold text-warn')}>
                <span className="font-mono text-[12px]">{m.key.env}</span> {m.key.present ? 'is set' : 'is not set'}
              </span>
            ) : (
              <span className="text-ink-2">none needed</span>
            )}
          </dd>
        </dl>
        <dl className={facts}>
          <dt className="text-faint">Price</dt>
          <dd className="text-ink-2">
            {m.price_in === null || m.price_out === null ? (
              <span className="text-muted">not set, so the verdict cannot rank it by cost</span>
            ) : m.price_in === 0 && m.price_out === 0 ? (
              'no API bill'
            ) : (
              <span className="num">
                {money(m.price_in)} in, {money(m.price_out)} out per million tokens
              </span>
            )}
          </dd>
          <dt className="text-faint">Settings</dt>
          <dd className="text-ink-2">{settings.join(' · ')}</dd>
        </dl>
        <div className="flex items-start gap-1.5 lg:justify-end">
          <button className="btn-ghost h-8 text-[12.5px]" onClick={() => test.mutate()} disabled={test.isPending}>
            <Radar size={14} /> {test.isPending ? 'Testing' : 'Test connection'}
          </button>
          <button className="btn-quiet h-8 text-[12.5px]" onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
          <button
            className="btn-quiet h-8 w-8 p-0 hover:text-bad-ink"
            title="Remove (archived if it has results)"
            aria-label={`Remove ${m.label}`}
            onClick={() => confirm(`Remove ${m.label}? Models with results are archived, not deleted.`) && remove.mutate()}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {r && (
        <div className={cx('mt-4 flex items-start gap-2 text-[13.5px]', r.ok && r.found ? 'text-good-ink' : 'font-semibold text-warn')}>
          {r.ok && r.found ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
          <span>{r.ok ? `${r.detail} · ${r.ms} ms` : r.error}</span>
        </div>
      )}
      {test.error && (
        <div className="mt-3">
          <ErrorNote error={test.error} />
        </div>
      )}
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
        subtitle="Local models through LM Studio or Ollama, and API models from Anthropic and OpenAI. Keys are read from environment variables, never stored. A price lets the verdict weigh cost."
        actions={
          <button className="btn-primary" onClick={() => setForm({})}>
            <Plus size={15} /> Add model
          </button>
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data?.length === 0 && (
        <div className="border-t-2 border-ink">
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
      {!!q.data?.length && (
        <div className="border-t-2 border-ink">
          {q.data.map((m, i) => (
            <ModelRow key={m.id} m={m} first={i === 0} onEdit={() => setForm({ model: m })} />
          ))}
        </div>
      )}
      {form && <ModelForm initial={form.model} editing={!!form.model} onClose={() => setForm(null)} />}
    </>
  );
}
