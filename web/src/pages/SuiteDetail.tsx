import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Download, Play, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ApiError, api, type Check, type RubricDimension, type Suite, type SuitePayload, type Task } from '../api';
import { NewRunModal } from '../components/runs';
import { YamlEditor } from '../components/LazyYaml';
import { cx, ErrorNote, Field, isNotFound, Loading, NotFound, PageHeader, Tabs } from '../components/ui';
import { plural } from '../lib/format';

type Tab = 'tasks' | 'rubric' | 'yaml';

const CHECK_TYPES: { value: Check['type']; label: string; hint: string }[] = [
  { value: 'exact', label: 'Exact answer', hint: 'Matches the answer after trimming and ignoring case; numbers compare by value.' },
  { value: 'contains', label: 'Contains', hint: 'Every phrase (or any, if you choose) appears in the answer.' },
  { value: 'not_contains', label: 'Avoids', hint: 'Fails if any of the phrases appears.' },
  { value: 'regex', label: 'Pattern', hint: 'A regular expression, found anywhere or matching the whole answer.' },
  { value: 'length', label: 'Length', hint: 'Bounds on words, characters, lines or sentences.' },
  { value: 'json', label: 'JSON', hint: 'Parses as JSON, optionally with required keys and values.' },
  { value: 'python', label: 'Python tests', hint: 'Runs the answer’s code with your tests in the sandbox.' },
];

const EXTRACTS = [
  { value: '', label: 'Default' },
  { value: 'full', label: 'Whole answer' },
  { value: 'final_answer', label: '“Answer:” line' },
  { value: 'last_line', label: 'Last line' },
  { value: 'code', label: 'First code block' },
  { value: 'json', label: 'First JSON value' },
];

const lines = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v.join('\n') : (v ?? ''));
const toList = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined)) as T;
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-ink-2">
      <input type="checkbox" className="h-3.5 w-3.5 accent-ink" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function CheckEditor({ check, onChange, onRemove }: { check: Check; onChange: (c: Check) => void; onRemove: () => void }) {
  const set = (patch: Partial<Check>) => onChange(clean({ ...check, ...patch }));
  const t = check.type;
  const meta = CHECK_TYPES.find((c) => c.value === t)!;
  return (
    <div className="rounded-[12px] border border-line-2 bg-panel-2 p-4">
      <div className="mb-3 flex items-center gap-2">
        <select
          className="input h-8 w-auto py-0 text-[12.5px] font-medium"
          aria-label="Check type"
          value={t}
          onChange={(e) => onChange({ type: e.target.value as Check['type'] })}
        >
          {CHECK_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          className="input h-8 flex-1 py-0 text-[12.5px]"
          placeholder="Label (optional)"
          aria-label="Check label"
          value={check.label ?? ''}
          onChange={(e) => set({ label: e.target.value })}
        />
        <input
          className="input num h-8 w-20 py-0 text-[12.5px]"
          type="number"
          min={0.1}
          step={0.5}
          title="Weight"
          aria-label="Weight"
          value={check.weight ?? 1}
          onChange={(e) => set({ weight: Number(e.target.value) || 1 })}
        />
        <button className="btn-quiet h-8 w-8 p-0" title="Remove check" aria-label="Remove check" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <p className="mb-3 text-[12px] text-faint">{meta.hint}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {t !== 'length' && (
          <Field label="Grade this part">
            <select className="input" value={check.extract ?? ''} onChange={(e) => set({ extract: e.target.value || undefined })}>
              {EXTRACTS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {t === 'exact' && (
          <>
            <Field label={Array.isArray(check.expect) ? 'Accepted answers, one per line' : 'Expected answer'} className="md:col-span-2">
              <textarea
                className="input min-h-[64px] font-mono text-[12.5px]"
                value={lines(check.expect)}
                onChange={(e) => set({ expect: Array.isArray(check.expect) ? toList(e.target.value) : e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-4 md:col-span-2">
              <Toggle checked={Array.isArray(check.expect)} onChange={(v) => set({ expect: v ? toList(lines(check.expect)) : lines(check.expect) })}>
                Several accepted answers
              </Toggle>
              <Toggle checked={!!check.case_sensitive} onChange={(v) => set({ case_sensitive: v || undefined })}>
                Case sensitive
              </Toggle>
            </div>
          </>
        )}
        {(t === 'contains' || t === 'not_contains') && (
          <>
            <Field label="Phrases, one per line" className="md:col-span-2">
              <textarea
                className="input min-h-[64px] font-mono text-[12.5px]"
                value={lines(check.expect)}
                onChange={(e) => set({ expect: toList(e.target.value) })}
              />
            </Field>
            <div className="flex flex-wrap gap-4 md:col-span-2">
              {t === 'contains' && (
                <Toggle checked={check.mode === 'any'} onChange={(v) => set({ mode: v ? 'any' : undefined })}>
                  Any one is enough
                </Toggle>
              )}
              <Toggle checked={!!check.case_sensitive} onChange={(v) => set({ case_sensitive: v || undefined })}>
                Case sensitive
              </Toggle>
            </div>
          </>
        )}
        {t === 'regex' && (
          <>
            <Field label="Pattern" className="md:col-span-2">
              <input className="input font-mono text-[12.5px]" value={check.pattern ?? ''} onChange={(e) => set({ pattern: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-4 md:col-span-2">
              {(['i', 'm', 's'] as const).map((f) => (
                <Toggle
                  key={f}
                  checked={(check.flags ?? '').includes(f)}
                  onChange={(v) => set({ flags: v ? `${check.flags ?? ''}${f}` : (check.flags ?? '').replace(f, '') || undefined })}
                >
                  {f === 'i' ? 'Ignore case' : f === 'm' ? 'Per line (^ $)' : 'Dot matches newline'}
                </Toggle>
              ))}
              <Toggle checked={!!check.fullmatch} onChange={(v) => set({ fullmatch: v || undefined })}>
                Whole answer must match
              </Toggle>
              <Toggle checked={!!check.negate} onChange={(v) => set({ negate: v || undefined })}>
                Pass when not found
              </Toggle>
            </div>
          </>
        )}
        {t === 'length' && (
          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <Field label="Unit">
              <select className="input" value={check.unit ?? 'words'} onChange={(e) => set({ unit: e.target.value as Check['unit'] })}>
                {['words', 'chars', 'lines', 'sentences'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Min">
              <input
                className="input num"
                type="number"
                min={0}
                value={check.min ?? ''}
                onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="Max">
              <input
                className="input num"
                type="number"
                min={0}
                value={check.max ?? ''}
                onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
        {t === 'json' && (
          <>
            <Field label="Required keys" hint="Comma separated.">
              <input
                className="input font-mono text-[12.5px]"
                value={(check.required ?? []).join(', ')}
                onChange={(e) =>
                  set({
                    required: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Expected values" hint='JSON object, e.g. {"city": "Tokyo"}'>
              <input
                className="input font-mono text-[12.5px]"
                defaultValue={check.equals ? JSON.stringify(check.equals) : ''}
                onBlur={(e) => {
                  try {
                    set({ equals: e.target.value.trim() ? JSON.parse(e.target.value) : undefined });
                  } catch {
                    /* keep the last valid value */
                  }
                }}
              />
            </Field>
          </>
        )}
        {t === 'python' && (
          <>
            <Field label="Timeout (seconds)">
              <input
                className="input num"
                type="number"
                min={1}
                max={60}
                value={check.timeout ?? 5}
                onChange={(e) => set({ timeout: Number(e.target.value) || 5 })}
              />
            </Field>
            <Field
              label="Tests"
              className="md:col-span-2"
              hint="Appended to the code from the answer and run in the sandbox. Any exception fails the check."
            >
              <textarea
                className="input min-h-[110px] font-mono text-[12.5px] leading-relaxed"
                value={check.tests ?? ''}
                onChange={(e) => set({ tests: e.target.value })}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function TaskEditor({
  task,
  categories,
  onChange,
  onRemove,
}: {
  task: Task;
  categories: string[];
  onChange: (t: Task) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Task>) => onChange({ ...task, ...patch });
  return (
    <div className="space-y-4 border-t border-line bg-ink/[0.012] px-5 py-5">
      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr]">
        <Field label="Id">
          <input className="input font-mono text-[12.5px]" value={task.id} onChange={(e) => set({ id: e.target.value })} />
        </Field>
        <Field label="Title">
          <input className="input" value={task.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Category">
          <input className="input" list="categories" value={task.category} onChange={(e) => set({ category: e.target.value })} />
          <datalist id="categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Prompt">
        <textarea
          className="input min-h-[140px] font-mono text-[12.5px] leading-relaxed"
          value={task.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Reference answer" hint="Shown to raters on request. Never sent to the model.">
          <textarea className="input min-h-[64px]" value={task.reference ?? ''} onChange={(e) => set({ reference: e.target.value || null })} />
        </Field>
        <Field label="System prompt" hint="Optional. Overrides the suite's system prompt.">
          <textarea className="input min-h-[64px]" value={task.system ?? ''} onChange={(e) => set({ system: e.target.value || null })} />
        </Field>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13.5px] font-semibold text-ink-2">Automatic checks</span>
          <span className="text-[12px] text-faint">The task passes when every check passes</span>
        </div>
        <div className="space-y-2.5">
          {task.checks.map((c, i) => (
            <CheckEditor
              key={i}
              check={c}
              onChange={(nc) => set({ checks: task.checks.map((x, j) => (j === i ? nc : x)) })}
              onRemove={() => set({ checks: task.checks.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button
            className="btn-ghost h-8 text-[12.5px]"
            onClick={() => set({ checks: [...task.checks, { type: 'exact', expect: '', extract: 'final_answer' }] })}
          >
            <Plus size={14} /> Add check
          </button>
          <button className="btn-quiet h-8 text-[12.5px] hover:text-bad-ink" onClick={onRemove}>
            <Trash2 size={14} /> Delete task
          </button>
        </div>
      </div>
    </div>
  );
}

function RubricEditor({ rubric, onChange }: { rubric: RubricDimension[]; onChange: (r: RubricDimension[]) => void }) {
  return (
    <div className="card p-5">
      <p className="mb-4 text-[13px] text-muted">
        Raters score each response from 1 (unusable) to 5 (excellent) on every dimension, then pick the better response and justify it.
      </p>
      <div className="space-y-2.5">
        {rubric.map((d, i) => (
          <div key={i} className="grid items-start gap-2.5 rounded-[12px] border border-line-2 bg-panel-2 p-3 md:grid-cols-[180px_200px_1fr_auto]">
            <input
              className="input font-mono text-[12.5px]"
              aria-label="Dimension id"
              value={d.id}
              onChange={(e) => onChange(rubric.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
            />
            <input
              className="input"
              aria-label="Dimension name"
              value={d.label}
              onChange={(e) => onChange(rubric.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              className="input"
              value={d.description}
              placeholder="What a rater should look for"
              aria-label="What a rater should look for"
              onChange={(e) => onChange(rubric.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            />
            <button
              className="btn-quiet h-9 w-9 p-0"
              onClick={() => onChange(rubric.filter((_, j) => j !== i))}
              title="Remove"
              aria-label={`Remove ${d.label || 'dimension'}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="btn-ghost mt-3 h-8 text-[12.5px]"
        onClick={() => onChange([...rubric, { id: `dimension_${rubric.length + 1}`, label: 'New dimension', description: '' }])}
      >
        <Plus size={14} /> Add dimension
      </button>
    </div>
  );
}

export function SuiteDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suite', id], queryFn: () => api.get<SuitePayload>(`/suites/${id}`) });
  const [tab, setTab] = useState<Tab>('tasks');
  const [draft, setDraft] = useState<Suite | null>(null);
  const [yamlText, setYamlText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => {
    if (q.data) {
      setDraft(structuredClone(q.data.suite));
      setYamlText(q.data.yaml);
    }
  }, [q.data]);

  const formDirty = useMemo(() => !!q.data && !!draft && JSON.stringify(draft) !== JSON.stringify(q.data.suite), [draft, q.data]);
  const yamlDirty = !!q.data && yamlText !== q.data.yaml;

  useEffect(() => {
    if (tab !== 'yaml' || !yamlDirty) {
      setErrors([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api.post<{ ok: boolean; errors?: string[] }>('/suites/validate', { yaml: yamlText });
      setErrors(r.ok ? [] : (r.errors ?? []));
    }, 350);
    return () => clearTimeout(t);
  }, [yamlText, tab, yamlDirty]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.put<SuitePayload>(`/suites/${id}`, body),
    onSuccess: (data) => {
      qc.setQueryData(['suite', id], data);
      qc.invalidateQueries({ queryKey: ['suites'] });
      setErrors([]);
    },
    onError: (e) => setErrors(e instanceof ApiError && e.details.length ? e.details : [String((e as Error).message)]),
  });

  // A failed load never fills the draft, so the error comes first or the spinner never ends.
  if (isNotFound(q.error)) return <NotFound what="suite" href="/suites" back="All suites" />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (q.isLoading || !draft) return <Loading />;
  const p = q.data!;
  const categories = [...new Set(draft.tasks.map((t) => t.category))];
  const dirty = tab === 'yaml' ? yamlDirty : formDirty;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/suites" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft size={14} /> Suites
          </Link>
        }
        title={p.title}
        subtitle={p.description}
        actions={
          <>
            <a className="btn-ghost" href={`/api/suites/${id}/yaml`}>
              <Download size={14} /> YAML
            </a>
            <button className="btn-primary" onClick={() => setRunOpen(true)}>
              <Play size={15} /> Run suite
            </button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => {
          if (dirty) return;
          setTab(t);
        }}
        tabs={[
          { value: 'tasks', label: `Tasks · ${draft.tasks.length}` },
          { value: 'rubric', label: `Rubric · ${draft.rubric.length}` },
          { value: 'yaml', label: 'YAML' },
        ]}
      />

      {tab === 'tasks' && (
        <div className="card overflow-hidden">
          {draft.tasks.map((t, i) => {
            const isOpen = open === `${i}`;
            return (
              <div key={i} className={cx(i > 0 && 'border-t border-line')}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : `${i}`)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-ink/[0.02]"
                >
                  <ChevronRight size={15} className={cx('shrink-0 text-faint transition-transform', isOpen && 'rotate-90')} />
                  <span className="hidden w-[150px] shrink-0 truncate font-mono text-[11.5px] text-faint sm:block">{t.id}</span>
                  {/* On a phone the id moves under the title, so the title gets the width. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{t.title || t.prompt.slice(0, 80)}</span>
                    <span className="block truncate font-mono text-[11px] text-faint sm:hidden">{t.id}</span>
                  </span>
                  <span className="chip hidden capitalize sm:inline-flex">{t.category}</span>
                  <span className="hidden w-[190px] justify-end gap-1 md:flex">
                    {t.checks.length ? (
                      [...new Set(t.checks.map((c) => c.type))].map((type) => (
                        <span key={type} className="rounded-[6px] bg-ink/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                          {type === 'not_contains' ? 'avoids' : type}
                          {t.checks.filter((c) => c.type === type).length > 1 ? ` ×${t.checks.filter((c) => c.type === type).length}` : ''}
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-faint">human only</span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <TaskEditor
                    task={t}
                    categories={categories}
                    onChange={(nt) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? nt : x)) })}
                    onRemove={() => {
                      setDraft({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) });
                      setOpen(null);
                    }}
                  />
                )}
              </div>
            );
          })}
          <div className="border-t border-line px-5 py-3">
            <button
              className="btn-quiet h-8 text-[12.5px]"
              onClick={() => {
                const n = draft.tasks.length + 1;
                setDraft({
                  ...draft,
                  tasks: [
                    ...draft.tasks,
                    { id: `task-${n}`, title: 'New task', category: categories[0] ?? 'general', prompt: 'Write the prompt here.', checks: [] },
                  ],
                });
                setOpen(`${draft.tasks.length}`);
              }}
            >
              <Plus size={14} /> Add task
            </button>
          </div>
        </div>
      )}

      {tab === 'rubric' && <RubricEditor rubric={draft.rubric} onChange={(r) => setDraft({ ...draft, rubric: r })} />}

      {tab === 'yaml' && <YamlEditor value={yamlText} onChange={setYamlText} minHeight={620} />}

      {errors.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-bad/30 bg-bad/[0.07] px-4 py-3">
          <div className="mb-1 text-[12.5px] font-semibold text-bad-ink">The suite has {plural(errors.length, 'problem')}</div>
          <ul className="space-y-0.5 font-mono text-[12px] text-ink-2">
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {dirty && (
        <div className="sticky bottom-4 z-20 mt-5 flex items-center justify-between gap-3 rounded-[14px] border border-line-2 bg-panel px-5 py-3 shadow-[0_20px_50px_-24px_rgb(var(--shade)/0.5)] backdrop-blur animate-rise">
          <span className="text-[13px] text-ink-2">Unsaved changes{tab !== 'yaml' ? ' · saving rewrites the YAML from the form' : ''}</span>
          <div className="flex gap-2">
            <button
              className="btn-ghost h-8"
              onClick={() => {
                setDraft(structuredClone(p.suite));
                setYamlText(p.yaml);
                setErrors([]);
              }}
            >
              Discard
            </button>
            <button
              className="btn-primary h-8"
              disabled={save.isPending || (tab === 'yaml' && errors.length > 0)}
              onClick={() => save.mutate(tab === 'yaml' ? { yaml: yamlText } : { suite: draft })}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <NewRunModal open={runOpen} onClose={() => setRunOpen(false)} suiteId={id} />
    </>
  );
}
