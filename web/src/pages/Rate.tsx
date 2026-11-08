import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Eye, PartyPopper, Scale, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { api, type Model, type NextPair, type Overview, type Pair, type RatingRow, type RunListItem } from '../api';
import { Markdown } from '../components/Markdown';
import { cx, Empty, ErrorNote, Loading, ModelDot, PageHeader, Segmented } from '../components/ui';
import { plural } from '../lib/format';
import { useMeta, useRater } from '../lib/hooks';

type Side = 'a' | 'b';

const PREFS = [
  { value: -3, short: 'Much better', side: 'a' as const },
  { value: -2, short: 'Better', side: 'a' as const },
  { value: -1, short: 'Slightly better', side: 'a' as const },
  { value: 0, short: 'About the same', side: null },
  { value: 1, short: 'Slightly better', side: 'b' as const },
  { value: 2, short: 'Better', side: 'b' as const },
  { value: 3, short: 'Much better', side: 'b' as const },
];

const SCALE_HINT = ['', 'Unusable', 'Major problems', 'Acceptable', 'Good', 'Excellent'];

function RaterGate({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="card mx-auto max-w-[460px] p-7 text-center">
      <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[12px] border border-line-2 bg-white/[0.03] text-accent">
        <Scale size={18} />
      </div>
      <div className="text-[15px] font-semibold">Who is rating?</div>
      <p className="mt-1.5 text-[13px] text-muted">
        A name or initials, saved in this browser. It labels your ratings and keeps your queue separate from other raters.
      </p>
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <input className="input" autoFocus placeholder="e.g. sam" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" disabled={!name.trim()}>
          Start
        </button>
      </form>
    </div>
  );
}

function SideBadge({ side }: { side: Side }) {
  return (
    <span
      className={cx(
        'slab grid h-8 w-8 place-items-center rounded-[8px] text-[17px] font-bold',
        side === 'a' ? 'bg-side-a/15 text-side-a ring-1 ring-side-a/40' : 'bg-side-b/15 text-side-b ring-1 ring-side-b/40',
      )}
    >
      {side.toUpperCase()}
    </span>
  );
}

function ScoreRow({
  label,
  description,
  value,
  onChange,
  side,
}: {
  label: string;
  description: string;
  value?: number;
  onChange: (v: number) => void;
  side: Side;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px]">
      <span className="min-w-0 text-[12.5px] text-ink-2" title={description}>
        {label}
      </span>
      <div className="flex shrink-0 gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              title={`${n} · ${SCALE_HINT[n]}`}
              onClick={() => onChange(n)}
              className={cx(
                'num h-7 w-7 rounded-[7px] border text-[12px] font-semibold transition-all',
                on
                  ? side === 'a'
                    ? 'border-side-a bg-side-a text-[#04111f]'
                    : 'border-side-b bg-side-b text-[#1d1300]'
                  : value && n < value
                    ? side === 'a'
                      ? 'border-side-a/30 bg-side-a/15 text-side-a'
                      : 'border-side-b/30 bg-side-b/15 text-side-b'
                    : 'border-line-2 bg-white/[0.02] text-muted hover:text-ink hover:border-white/25',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScopePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/overview') });
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.get<RunListItem[]>('/runs') });
  return (
    <div className="relative">
      <select className="input h-9 appearance-none pr-8 py-0" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Latest answer per model">
          {overview.data?.rating.map((r) => (
            <option key={r.suite_id} value={`suite:${r.suite_id}`}>
              {r.title}, all runs
            </option>
          ))}
        </optgroup>
        <optgroup label="One run">
          {runs.data
            ?.filter((r) => r.models.length > 1)
            .map((r) => (
              <option key={r.id} value={`run:${r.id}`}>
                Run #{r.id} · {r.suite_title}
                {r.label ? ` · ${r.label}` : ''}
              </option>
            ))}
        </optgroup>
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Rate() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/overview') });
  const scope = params.get('run')
    ? `run:${params.get('run')}`
    : params.get('suite')
      ? `suite:${params.get('suite')}`
      : overview.data?.rating[0]
        ? `suite:${overview.data.rating[0].suite_id}`
        : '';
  const [rater, setRater] = useRater();

  if (!rater) {
    return (
      <>
        <PageHeader title="Rate blind" subtitle="Two anonymous answers to the same task. Score each, pick the better one and say why." />
        <RaterGate onSave={setRater} />
      </>
    );
  }
  if (overview.isLoading) return <Loading />;
  if (!scope) {
    return (
      <>
        <PageHeader title="Rate blind" />
        <div className="card">
          <Empty
            icon={<Scale size={18} />}
            title="Nothing to rate yet"
            action={
              <Link href="/runs" className="btn-primary">
                Start a run
              </Link>
            }
          >
            Run a suite against two or more models and their answers will queue up here as anonymous pairs.
          </Empty>
        </div>
      </>
    );
  }
  const [kind, id] = scope.split(':');
  return (
    <Rater
      key={`${scope}:${rater}`}
      rater={rater}
      scope={scope}
      runId={kind === 'run' ? Number(id) : undefined}
      suiteId={kind === 'suite' ? id : undefined}
      onScope={(v) => {
        const [k, x] = v.split(':');
        navigate(`/rate?${k}=${x}`);
      }}
      onRater={setRater}
    />
  );
}

/** The signature moment: once a queue is done, the cards turn over and show who wrote what. Labels
 *  stay hidden until then, so they can never sway a rating. */
function Reveal({ rater, runId, suiteId }: { rater: string; runId?: number; suiteId?: string }) {
  const ratings = useQuery({
    queryKey: ['reveal', rater, runId, suiteId],
    queryFn: () => api.get<RatingRow[]>(`/ratings?limit=1000${suiteId ? `&suite=${suiteId}` : ''}`),
  });
  const models = useQuery({ queryKey: ['models-all'], queryFn: () => api.get<Model[]>('/models?archived=true') });
  const mine = (ratings.data ?? []).filter((r) => r.rater === rater && (!runId || r.run_id === runId));
  if (!mine.length || !models.data) return null;
  const byId = new Map(models.data.map((m) => [m.id, m]));
  const tally = new Map<number, { wins: number; games: number }>();
  for (const r of mine) {
    const sides: [number, number][] = [
      [r.model_a, r.preference < 0 ? 1 : r.preference === 0 ? 0.5 : 0],
      [r.model_b, r.preference > 0 ? 1 : r.preference === 0 ? 0.5 : 0],
    ];
    for (const [id, score] of sides) {
      const t = tally.get(id) ?? { wins: 0, games: 0 };
      t.wins += score;
      t.games += 1;
      tally.set(id, t);
    }
  }
  const order = [...tally.entries()].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games);
  const card = (id: number, won: boolean, delay: number) => {
    const m = byId.get(id);
    return (
      <span
        className={cx(
          'animate-flip relative flex min-w-0 flex-1 items-center gap-2 rounded-[9px] border px-3 py-2 text-[12.5px]',
          won ? 'border-mark/50 bg-mark/[0.08] text-ink' : 'border-line-2 bg-white/[0.02] text-muted',
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        {m && <ModelDot color={m.color} size={7} />}
        <span className="truncate">{m?.label ?? `model ${id}`}</span>
        {won && (
          <svg className="ml-auto shrink-0" width="16" height="16" viewBox="0 0 16 16" aria-label="preferred">
            <path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="var(--color-mark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    );
  };
  return (
    <section className="card mt-5 p-6">
      <h2 className="slab text-[26px] font-bold leading-tight">The labels, revealed</h2>
      <p className="mt-1 text-[13px] text-muted">
        You judged {mine.length} {mine.length === 1 ? 'pair' : 'pairs'} without knowing who wrote what. Here is who did.
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          {order.map(([id, t]) => {
            const m = byId.get(id);
            return (
              <div key={id}>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="flex items-center gap-2 text-ink-2">
                    {m && <ModelDot color={m.color} size={7} />}
                    {m?.label ?? id}
                  </span>
                  <span className="slab text-[16px] font-bold">{Math.round((t.wins / t.games) * 100)}%</span>
                </div>
                <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full" style={{ width: `${(t.wins / t.games) * 100}%`, background: m?.color }} />
                </div>
                <div className="mt-1 text-[11.5px] text-faint">
                  preferred in {t.wins} of {t.games}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-1.5">
          {mine.slice(0, 12).map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="w-[130px] shrink-0 truncate font-mono text-[11px] text-faint">{r.task_id}</span>
              <span className="slab w-4 text-center text-[13px] font-bold text-side-a">A</span>
              {card(r.model_a, r.preference < 0, i * 70)}
              <span className="slab w-4 text-center text-[13px] font-bold text-side-b">B</span>
              {card(r.model_b, r.preference > 0, i * 70 + 35)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Rater({
  rater,
  scope,
  runId,
  suiteId,
  onScope,
  onRater,
}: {
  rater: string;
  scope: string;
  runId?: number;
  suiteId?: string;
  onScope: (v: string) => void;
  onRater: (v: string) => void;
}) {
  const qc = useQueryClient();
  const meta = useMeta();
  const minChars = meta.data?.min_justification ?? 30;
  const flagsList = meta.data?.rating?.flags ?? [];
  const [skipped, setSkipped] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const qs = new URLSearchParams({ rater, ...(runId ? { run: String(runId) } : { suite: suiteId! }), skip: skipped.join(',') });
  const q = useQuery({ queryKey: ['pair', scope, rater, round], queryFn: () => api.get<NextPair>(`/rate/next?${qs}`), staleTime: Infinity });

  const [scores, setScores] = useState<Record<Side, Record<string, number>>>({ a: {}, b: {} });
  const [flags, setFlags] = useState<Record<Side, string[]>>({ a: [], b: [] });
  const [preference, setPreference] = useState<number | null>(null);
  const [justification, setJustification] = useState('');
  const [confidence, setConfidence] = useState<string>('high');
  const [showRef, setShowRef] = useState(false);
  const [saved, setSaved] = useState(0);
  const started = useRef(Date.now());
  const pair = q.data && !q.data.done ? (q.data as Pair) : null;

  useEffect(() => {
    setScores({ a: {}, b: {} });
    setFlags({ a: [], b: [] });
    setPreference(null);
    setJustification('');
    setConfidence('high');
    setShowRef(false);
    started.current = Date.now();
  }, [pair?.key]);

  const allScored = useMemo(() => (pair ? pair.rubric.every((d) => scores.a[d.id] && scores.b[d.id]) : false), [pair, scores]);
  const ready = pair && preference !== null && justification.trim().length >= minChars && allScored;

  const submit = useMutation({
    mutationFn: () =>
      api.post('/ratings', {
        result_a: pair!.a.result_id,
        result_b: pair!.b.result_id,
        run_id: runId ?? null,
        preference,
        scores,
        flags,
        justification,
        confidence,
        rater,
        seconds: Math.round((Date.now() - started.current) / 1000),
      }),
    onSuccess: () => {
      setSaved((n) => n + 1);
      setRound((r) => r + 1);
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const skip = useCallback(() => {
    if (!pair) return;
    setSkipped((s) => [...s, pair.key]);
    setRound((r) => r + 1);
  }, [pair]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT';
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (ready && !submit.isPending) submit.mutate();
        e.preventDefault();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-7]$/.test(e.key)) setPreference(Number(e.key) - 4);
      if (e.key === 's') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, submit, skip]);

  const progress = q.data?.progress;
  const header = (
    <PageHeader
      title="Rate blind"
      subtitle="Two anonymous answers to one task, shuffled. Score each, choose the better one and say why."
      actions={
        <>
          <ScopePicker value={scope} onChange={onScope} />
          <button className="btn-quiet text-[12.5px]" title="Change rater" onClick={() => onRater('')}>
            {rater}
          </button>
        </>
      }
    />
  );

  if (q.isLoading)
    return (
      <>
        {header}
        <Loading />
      </>
    );
  if (q.error)
    return (
      <>
        {header}
        <ErrorNote error={q.error} />
      </>
    );
  if (!pair) {
    return (
      <>
        {header}
        <div className="card">
          <Empty
            icon={<PartyPopper size={18} />}
            title={progress?.total ? 'Every pair is judged' : 'No pairs here'}
            action={
              <Link href="/scoreboard" className="btn-primary">
                See the scoreboard
              </Link>
            }
          >
            {progress?.total
              ? `You rated all ${plural(progress.total, 'pair')} in this scope${saved ? `, ${saved} of them just now` : ''}.`
              : 'This scope needs answers from at least two models to the same task.'}
          </Empty>
        </div>
        <Reveal rater={rater} runId={runId} suiteId={suiteId} />
      </>
    );
  }

  const done = pair.progress.rated;
  const total = pair.progress.total;
  const remainingChars = Math.max(0, minChars - justification.trim().length);

  return (
    <>
      {header}
      <div className="mb-5 flex items-center gap-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="num text-[12.5px] text-muted">
          {done} of {total} rated
        </span>
      </div>

      <section className="card mb-5 animate-rise" key={pair.key}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="chip capitalize">{pair.task.category}</span>
            <span className="truncate text-[14px] font-semibold">{pair.task.title}</span>
          </div>
          {pair.task.reference && (
            <button className="btn-quiet h-7 text-[12px]" onClick={() => setShowRef((s) => !s)}>
              <Eye size={13} /> {showRef ? 'Hide reference' : 'Show reference'}
            </button>
          )}
        </div>
        <div className="px-5 py-4">
          <Markdown text={pair.task.prompt} />
          {showRef && pair.task.reference && (
            <div className="mt-3 rounded-[9px] border border-good/20 bg-good/[0.05] px-3 py-2 text-[12.5px] text-ink-2">
              <span className="font-semibold text-good-ink">Reference:</span> {pair.task.reference}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2" key={`${pair.key}-answers`}>
        {(['a', 'b'] as Side[]).map((side) => (
          <article
            key={side}
            className={cx(
              'card flex flex-col overflow-hidden animate-rise',
              preference !== null &&
                preference !== 0 &&
                preference < 0 === (side === 'a') &&
                (side === 'a' ? 'border-side-a/40' : 'border-side-b/40'),
            )}
          >
            <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <SideBadge side={side} />
              <span className="text-[13.5px] font-semibold">Response {side.toUpperCase()}</span>
            </header>
            <div className="flex-1 px-5 py-4">
              <Markdown text={pair[side].output} />
            </div>
            <footer className="border-t border-line bg-white/[0.012] px-5 py-3.5">
              {pair.rubric.map((d) => (
                <ScoreRow
                  key={d.id}
                  side={side}
                  label={d.label}
                  description={d.description}
                  value={scores[side][d.id]}
                  onChange={(v) => setScores((s) => ({ ...s, [side]: { ...s[side], [d.id]: v } }))}
                />
              ))}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {flagsList.map((f) => {
                  const on = flags[side].includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFlags((s) => ({ ...s, [side]: on ? s[side].filter((x) => x !== f.id) : [...s[side], f.id] }))}
                      className={cx('chip h-[26px] transition-colors', on ? 'border-serious/45 bg-serious/[0.14] text-serious' : 'hover:text-ink')}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </footer>
          </article>
        ))}
      </div>

      <section className="card mt-5 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold">Which response is better overall?</h2>
          <span className="hidden text-[11.5px] text-faint md:inline">
            Keys <span className="kbd">1</span>–<span className="kbd">7</span> choose · <span className="kbd">S</span> skips ·{' '}
            <span className="kbd">Ctrl</span>+<span className="kbd">↵</span> submits
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {PREFS.map((p, i) => {
            const on = preference === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreference(p.value)}
                className={cx(
                  'flex h-[62px] flex-col items-center justify-center gap-1 rounded-[10px] border px-1 text-center transition-all',
                  on
                    ? p.side === 'a'
                      ? 'border-side-a bg-side-a/[0.16] text-ink'
                      : p.side === 'b'
                        ? 'border-side-b bg-side-b/[0.16] text-ink'
                        : 'border-white/40 bg-white/[0.08] text-ink'
                    : 'border-line-2 bg-white/[0.02] text-muted hover:border-white/20 hover:text-ink',
                )}
              >
                <span
                  className={cx(
                    'slab text-[16px] font-bold leading-none',
                    p.side === 'a' ? 'text-side-a' : p.side === 'b' ? 'text-side-b' : 'text-ink-2',
                  )}
                >
                  {p.side ? p.side.toUpperCase() : '='}
                </span>
                <span className="text-[11.5px] leading-tight">{p.short}</span>
                <span className="kbd hidden h-4 min-w-4 text-[9.5px] md:inline-flex">{i + 1}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label className="mb-1.5 flex items-baseline justify-between text-[12.5px] font-medium text-ink-2">
              <span>Justification</span>
              <span className={cx('num text-[11.5px] font-normal', remainingChars ? 'text-faint' : 'text-good-ink')}>
                {remainingChars ? `${remainingChars} more characters` : `${justification.trim().length} characters`}
              </span>
            </label>
            <textarea
              className="input min-h-[96px] resize-y leading-relaxed"
              placeholder="Point to specific parts of each answer: what is right, what is wrong, what is missing, and why that decides it."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-between gap-4 md:w-[230px]">
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Confidence</div>
              <Segmented
                value={confidence}
                onChange={setConfidence}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={skip}>
                <SkipForward size={14} /> Skip
              </button>
              <button className="btn-primary flex-1" disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
                Submit
              </button>
            </div>
          </div>
        </div>
        {!allScored && <div className="mt-3 text-[12px] text-faint">Score both responses on every dimension to submit.</div>}
        <div className="mt-3">
          <ErrorNote error={submit.error} />
        </div>
      </section>
    </>
  );
}
