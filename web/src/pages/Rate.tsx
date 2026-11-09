import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Eye, EyeOff, Scale, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { api, type Model, type NextPair, type Overview, type Pair, type RatingRow, type RunListItem } from '../api';
import { Markdown } from '../components/Markdown';
import { cx, Empty, ErrorNote, Loading, ModelDot, PageHeader, PenRing, PenTick, Segmented } from '../components/ui';
import { plural } from '../lib/format';
import { useMeta, useRater } from '../lib/hooks';
import { tone } from '../lib/theme';

type Side = 'a' | 'b';

const STOPS = [
  { value: -3, label: 'A, clearly', side: 'a' as const },
  { value: -2, label: 'A', side: 'a' as const },
  { value: -1, label: 'A, a little', side: 'a' as const },
  { value: 0, label: 'Even', side: null },
  { value: 1, label: 'B, a little', side: 'b' as const },
  { value: 2, label: 'B', side: 'b' as const },
  { value: 3, label: 'B, clearly', side: 'b' as const },
];

const SCALE_HINT = ['', 'Unusable', 'Major problems', 'Acceptable', 'Good', 'Excellent'];
const sideColor = (s: Side) => (s === 'a' ? 'var(--color-side-a)' : 'var(--color-side-b)');

function RaterGate({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="card mx-auto max-w-[480px] p-8">
      <div className="slab text-[30px] leading-tight font-semibold">Who is judging?</div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        A name or initials, kept in this browser. It signs your verdicts and keeps your queue apart from other judges.
      </p>
      <form
        className="mt-6 flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <input
          className="input"
          autoFocus
          aria-label="Your name or initials"
          placeholder="e.g. sam"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-primary" disabled={!name.trim()}>
          Start judging
        </button>
      </form>
    </div>
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
    <div className="flex items-center justify-between gap-4 py-[7px]">
      <span className="min-w-0 text-[14px] text-ink-2" title={description}>
        {label}
      </span>
      <div className="flex shrink-0 gap-[5px]">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          const under = value !== undefined && n < value;
          return (
            <button
              key={n}
              type="button"
              title={`${n} · ${SCALE_HINT[n]}`}
              aria-label={`${label}, answer ${side.toUpperCase()}: ${n}, ${SCALE_HINT[n]}`}
              aria-pressed={on}
              onClick={() => onChange(n)}
              className={cx(
                'num h-[30px] w-[30px] rounded-[7px] border text-[13px] font-semibold transition-all',
                on
                  ? 'border-transparent text-on-side shadow-[0_2px_6px_-2px_rgb(var(--shade)/0.4)]'
                  : under
                    ? 'border-transparent'
                    : 'border-line-2 bg-panel text-faint hover:border-ink/40 hover:text-ink',
              )}
              style={
                on
                  ? { background: sideColor(side) }
                  : under
                    ? { background: `color-mix(in srgb, ${sideColor(side)} 14%, transparent)`, color: sideColor(side) }
                    : undefined
              }
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
      <select
        aria-label="What to judge"
        className="input h-10 appearance-none py-0 pr-9 text-[14px] font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <optgroup label="Latest answer per model">
          {overview.data?.rating.map((r) => (
            <option key={r.suite_id} value={`suite:${r.suite_id}`}>
              {r.title}, every run
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
      <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
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
        <PageHeader title="Judge blind" subtitle="Two answers to the same task, names hidden, order shuffled. Score each, give a verdict, say why." />
        <RaterGate onSave={setRater} />
      </>
    );
  }
  if (overview.isLoading) return <Loading />;
  if (!scope) {
    return (
      <>
        <PageHeader title="Judge blind" />
        <div className="card">
          <Empty
            icon={<Scale size={20} />}
            title="Nothing to judge yet"
            action={
              <Link href="/runs" className="btn-primary">
                Start a run
              </Link>
            }
          >
            Run a suite on two or more models and their answers will queue up here as anonymous pairs.
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
 *  stay hidden until then, so they can never sway a verdict. */
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
    for (const [mid, score] of sides) {
      const t = tally.get(mid) ?? { wins: 0, games: 0 };
      t.wins += score;
      t.games += 1;
      tally.set(mid, t);
    }
  }
  const order = [...tally.entries()].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games);
  const card = (mid: number, won: boolean, delay: number) => {
    const m = byId.get(mid);
    return (
      <span
        className={cx(
          'animate-flip flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-[14px]',
          won ? 'border-ink/70 bg-panel font-semibold text-ink' : 'border-line bg-panel-2 text-muted',
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        {m && <ModelDot color={m.color} size={8} />}
        <span className="truncate">{m?.label ?? `model ${mid}`}</span>
        {won && (
          <span className="ml-auto">
            <PenTick size={18} />
          </span>
        )}
      </span>
    );
  };
  return (
    <section className="mt-8">
      <h2 className="slab text-[38px] leading-tight font-semibold">The labels, revealed.</h2>
      <p className="mt-2 max-w-[60ch] text-[15.5px] text-muted">
        You judged {plural(mine.length, 'pair')} without knowing who wrote what. Here is who did, and who you kept picking.
      </p>
      <div className="mt-7 grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="card space-y-5 p-6">
          {order.map(([mid, t]) => {
            const m = byId.get(mid);
            const share = t.wins / t.games;
            return (
              <div key={mid}>
                <div className="flex items-baseline justify-between">
                  <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                    {m && <ModelDot color={m.color} />}
                    {m?.label ?? mid}
                  </span>
                  <span className="slab text-[24px] leading-none font-semibold">{Math.round(share * 100)}%</span>
                </div>
                <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-ink/[0.07]">
                  <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: tone(m?.color) }} />
                </div>
                <div className="mt-1.5 text-[12.5px] text-muted">
                  picked in {Number.isInteger(t.wins) ? t.wins : t.wins.toFixed(1)} of {t.games}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          {mine.slice(0, 12).map((r, i) => (
            <div key={r.id} className="flex items-center gap-2.5">
              <span className="hidden w-[150px] shrink-0 truncate font-mono text-[11.5px] text-faint sm:block">{r.task_id}</span>
              <span className="slab w-5 text-center text-[18px] font-bold text-side-a">A</span>
              {card(r.model_a, r.preference < 0, i * 70)}
              <span className="slab w-5 text-center text-[18px] font-bold text-side-b">B</span>
              {card(r.model_b, r.preference > 0, i * 70 + 35)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TastingCard({
  side,
  pair,
  scores,
  setScores,
  flags,
  setFlags,
  flagsList,
  chosen,
}: {
  side: Side;
  pair: Pair;
  scores: Record<Side, Record<string, number>>;
  setScores: React.Dispatch<React.SetStateAction<Record<Side, Record<string, number>>>>;
  flags: Record<Side, string[]>;
  setFlags: React.Dispatch<React.SetStateAction<Record<Side, string[]>>>;
  flagsList: { id: string; label: string }[];
  chosen: boolean;
}) {
  const letter = side.toUpperCase();
  return (
    <article
      className={cx(
        'card animate-deal relative flex flex-col overflow-hidden transition-[border-color,box-shadow] duration-300',
        chosen && 'border-ink/60 shadow-[0_18px_40px_-24px_rgb(var(--shade)/0.55)]',
      )}
      style={{ ['--deal-rot' as string]: side === 'a' ? '-1.2deg' : '1.2deg', animationDelay: side === 'a' ? '0ms' : '70ms' }}
    >
      <div className="absolute inset-x-0 top-0 h-[4px]" style={{ background: sideColor(side) }} />
      <header className="flex items-center gap-3 px-7 pt-6">
        <span className="slab text-[52px] leading-[0.8] font-bold" style={{ color: sideColor(side) }}>
          {letter}
        </span>
        <span className="text-[13px] font-medium text-muted">Answer {letter}</span>
        {chosen && (
          <span className="ml-auto flex items-center gap-1.5 text-[13px] font-semibold text-mark-ink">
            <PenTick size={20} /> your pick
          </span>
        )}
      </header>
      <div className="flex-1 px-7 pt-5 pb-7">
        <Markdown text={pair[side].output} />
      </div>
      <footer className="border-t border-line bg-panel-2 px-7 pt-4 pb-6">
        <div className="mb-1 text-[12.5px] font-semibold text-muted">Score this answer, 1 to 5</div>
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
        <div className="mt-4 mb-2 text-[12.5px] font-semibold text-muted">Anything wrong with it?</div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {flagsList.map((f) => {
            const on = flags[side].includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFlags((s) => ({ ...s, [side]: on ? s[side].filter((x) => x !== f.id) : [...s[side], f.id] }))}
                className={cx(
                  'flex items-center gap-2.5 rounded-[6px] py-1 text-left text-[13.5px] transition-colors',
                  on ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                <span
                  className={cx(
                    'grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] border-[1.5px]',
                    on ? 'border-mark bg-mark text-white' : 'border-ink/30 bg-panel',
                  )}
                >
                  {on && <Check size={11} strokeWidth={3.5} />}
                </span>
                {f.label}
              </button>
            );
          })}
        </div>
      </footer>
    </article>
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
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div>
        <h1 className="text-[34px] leading-[1.04] font-bold tracking-[-0.035em] md:text-[44px]">Judge blind</h1>
        <p className="mt-3 max-w-[58ch] text-[16px] leading-relaxed text-muted">
          Two answers to the same task, names hidden, order shuffled. Score each, give a verdict, say why.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <ScopePicker value={scope} onChange={onScope} />
        <button className="btn-quiet h-10 text-[13.5px]" title="Change judge" onClick={() => onRater('')}>
          {rater}
        </button>
      </div>
    </header>
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
        <div className="card px-8 py-10">
          <div className="slab text-[30px] leading-tight font-semibold">{progress?.total ? 'Every pair is judged.' : 'No pairs here.'}</div>
          <p className="mt-2 text-[15px] text-muted">
            {progress?.total
              ? `You judged all ${plural(progress.total, 'pair')} in this scope${saved ? `, ${saved} of them just now` : ''}.`
              : 'This scope needs answers from at least two models to the same task.'}
          </p>
          <Link href="/scoreboard" className="btn-primary mt-6">
            See the scoreboard
          </Link>
        </div>
        {progress && progress.remaining === 0 && <Reveal rater={rater} runId={runId} suiteId={suiteId} />}
      </>
    );
  }

  const done = pair.progress.rated;
  const total = pair.progress.total;
  const remainingChars = Math.max(0, minChars - justification.trim().length);

  return (
    <>
      {header}
      <div className="mb-7 flex items-center gap-4">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="num text-[13.5px] font-semibold text-ink-2">
          {done} of {total} judged
        </span>
      </div>

      <section className="mb-7 animate-rise" key={pair.key}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="chip capitalize">{pair.task.category}</span>
          <h2 className="text-[22px] font-semibold tracking-[-0.015em]">{pair.task.title}</h2>
          {pair.task.reference && (
            <button className="btn-quiet ml-auto h-8 text-[13px]" onClick={() => setShowRef((s) => !s)}>
              {showRef ? <EyeOff size={14} /> : <Eye size={14} />} {showRef ? 'Hide the reference' : 'Show the reference'}
            </button>
          )}
        </div>
        <div className="max-w-[86ch] text-[16px]">
          <Markdown text={pair.task.prompt} className="prose-answer text-[16px] text-ink" />
        </div>
        {showRef && pair.task.reference && (
          <div className="mt-4 max-w-[86ch] rounded-[10px] border border-good/25 bg-good-tint px-4 py-3 text-[14px] text-ink-2">
            <span className="font-semibold text-good">Reference: </span>
            {pair.task.reference}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2" key={`${pair.key}-cards`}>
        {(['a', 'b'] as Side[]).map((side) => (
          <TastingCard
            key={side}
            side={side}
            pair={pair}
            scores={scores}
            setScores={setScores}
            flags={flags}
            setFlags={setFlags}
            flagsList={flagsList}
            chosen={preference !== null && preference !== 0 && preference < 0 === (side === 'a')}
          />
        ))}
      </div>

      <section className="card mt-6 px-7 pt-6 pb-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.015em]">Your verdict</h2>
          <span className="hidden text-[12.5px] text-muted md:inline">
            <span className="kbd">1</span> to <span className="kbd">7</span> to choose, <span className="kbd">S</span> to skip,{' '}
            <span className="kbd">Ctrl</span> <span className="kbd">↵</span> to submit
          </span>
        </div>

        <div className="relative mt-8 mb-2 px-2">
          <div className="absolute top-[11px] right-[7%] left-[7%] h-[2px] rounded-full bg-ink/[0.12]" />
          <div className="relative grid grid-cols-7">
            {STOPS.map((s, i) => {
              const on = preference === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPreference(s.value)}
                  className="group relative flex flex-col items-center gap-2.5 pb-1"
                >
                  <span
                    className={cx(
                      'grid h-6 w-6 place-items-center rounded-full border-2 transition-all',
                      on ? 'scale-110 border-ink bg-ink' : 'border-ink/25 bg-panel group-hover:border-ink/60',
                    )}
                  >
                    {on && <span className="h-2 w-2 rounded-full bg-panel" />}
                  </span>
                  <span
                    className={cx(
                      'text-center text-[11.5px] leading-tight font-semibold transition-colors sm:text-[13px]',
                      on ? 'text-ink' : 'text-muted group-hover:text-ink-2',
                    )}
                    style={s.side && on ? { color: sideColor(s.side) } : undefined}
                  >
                    <span className="sr-only">Verdict: </span>
                    {s.label}
                  </span>
                  <span aria-hidden className="kbd hidden h-[18px] min-w-[18px] text-[10px] md:inline-flex">
                    {i + 1}
                  </span>
                  {on && <PenRing className="-inset-x-1 -top-3 -bottom-1" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-7 grid gap-6 md:grid-cols-[minmax(0,1fr)_250px]">
          <div>
            <label htmlFor="why" className="mb-2 flex items-baseline justify-between text-[13.5px] font-semibold text-ink-2">
              <span>Why?</span>
              <span className={cx('num text-[12.5px] font-medium', remainingChars ? 'text-muted' : 'text-good')}>
                {remainingChars ? `${remainingChars} more characters` : `${justification.trim().length} characters`}
              </span>
            </label>
            <textarea
              id="why"
              className="input ruled min-h-[116px] resize-y"
              placeholder="Point at the parts that decided it: what is right, what is wrong, what is missing."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-between gap-5">
            <div>
              <div className="mb-2 text-[13.5px] font-semibold text-ink-2">How sure are you?</div>
              <Segmented
                value={confidence}
                onChange={setConfidence}
                options={[
                  { value: 'low', label: 'Unsure' },
                  { value: 'medium', label: 'Fairly' },
                  { value: 'high', label: 'Certain' },
                ]}
              />
            </div>
            <div className="flex gap-2.5">
              <button className="btn-ghost" onClick={skip}>
                <SkipForward size={15} /> Skip
              </button>
              <button className="btn-primary flex-1" disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
                Submit verdict
              </button>
            </div>
          </div>
        </div>
        {!allScored && <div className="mt-4 text-[13px] text-muted">Score both answers on every line to submit.</div>}
        <div className="mt-3">
          <ErrorNote error={submit.error} />
        </div>
      </section>
    </>
  );
}
