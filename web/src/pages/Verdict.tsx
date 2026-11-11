import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, Play } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type Board, type Overview, type SuiteSummary, type Verdict as VerdictData, type VerdictModel } from '../api';
import { HistoryChart, RatingBar, WinMatrix } from '../components/charts';
import { FieldChart, MIN_BAR } from '../components/field';
import { NewRunModal } from '../components/runs';
import { cx, ErrorNote, isNotFound, Loading, ModelDot, NotFound, PenTick, Section, Segmented } from '../components/ui';
import { DEMO, REPO_URL } from '../lib/demo';
import { ms, pct, plural, shortDate, titleCase } from '../lib/format';
import { headline, holding, judges, type Part, standing } from '../lib/story';
import { type Decision, DEFAULT_BAR, decide, money, need, type Objective, share } from '../lib/verdict';

/** A sentence from the story layer, with its bold runs. */
function Say({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <strong key={i} className="font-semibold text-ink">
            {p.b}
          </strong>
        ),
      )}
    </>
  );
}

const latest = (suites: SuiteSummary[]) =>
  [...suites].sort(
    (a, b) => (b.last_run?.created_at ?? '').localeCompare(a.last_run?.created_at ?? '') || (b.last_run?.id ?? 0) - (a.last_run?.id ?? 0),
  )[0];

/** The home page: which model should do this job, and the proof. */
export function Verdict({ suite }: { suite?: string }) {
  const suites = useQuery({ queryKey: ['suites'], queryFn: () => api.get<SuiteSummary[]>('/suites') });
  if (suites.isLoading) return <Loading />;
  if (suites.error) return <ErrorNote error={suites.error} />;
  const withRuns = (suites.data ?? []).filter((s) => s.runs > 0);
  if (!suite && !withRuns.length) return <Start />;
  const current = suite ?? latest(withRuns).id;
  // The key gives each job its own bar: what you set for one never carries over to the next.
  return <Sheet key={current} id={current} suites={withRuns} />;
}

function Sheet({ id, suites }: { id: string; suites: SuiteSummary[] }) {
  const path = encodeURIComponent(id);
  const verdict = useQuery({ queryKey: ['verdict', id], queryFn: () => api.get<VerdictData>(`/verdict/${path}`), refetchInterval: 10_000 });
  const board = useQuery({ queryKey: ['board', id], queryFn: () => api.get<Board>(`/scoreboard/${path}`), refetchInterval: 10_000 });
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/overview') });
  const [choice, setChoice] = useState<number | null>(null);
  const [objective, setObjective] = useState<Objective>('cost');
  const [newRun, setNewRun] = useState(false);

  const v = verdict.data;
  const bar = choice ?? v?.suite.bar ?? DEFAULT_BAR;
  const d = useMemo(() => (v ? decide(v.models, bar, objective) : null), [v, bar, objective]);
  // The same rule over every past run, at the bar on screen.
  const picks = useMemo(
    () =>
      (v?.history ?? []).map(
        (p) =>
          decide(
            Object.entries(p.models).map(([mid, m]) => ({ id: Number(mid), ...m })),
            bar,
            objective,
          ).pick,
      ),
    [v, bar, objective],
  );

  if (verdict.isLoading) return <Loading />;
  if (isNotFound(verdict.error)) return <NotFound what="suite" href="/" back="Back to the verdict" />;
  if (!v || !d) return <ErrorNote error={verdict.error} />;

  const h = headline(v.models, d);
  const total = v.suite.tasks.length;
  const last = v.history[v.history.length - 1];
  const toJudge = overview.data?.rating.find((r) => r.suite_id === id)?.remaining ?? 0;
  const name = (mid: number) => v.models.find((m) => m.id === mid)?.label ?? `model ${mid}`;
  const [lead, rest] = h.title.startsWith('Use ') ? ['Use', h.title.slice(4)] : [h.title, ''];
  const size = rest.length > 20 ? 'text-[34px] md:text-[44px]' : rest.length > 12 ? 'text-[42px] md:text-[56px]' : 'text-[52px] md:text-[72px]';

  return (
    <div>
      <div className="mb-9 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 md:mb-12">
        <Jobs suites={suites} current={id} title={v.suite.title} />
        <button type="button" className="btn-ghost h-9 px-3.5 text-[13.5px]" onClick={() => setNewRun(true)}>
          <Play size={13} /> New run
        </button>
      </div>

      {v.models.length === 0 ? (
        <div className="pb-16">
          <h1 className="max-w-[14ch] text-[44px] leading-[0.98] font-bold tracking-[-0.04em] text-balance md:text-[64px]">{h.title}</h1>
          <p className="mt-6 max-w-[46ch] text-[18px] leading-[1.5] text-ink-2">
            <Say parts={h.lines[0] ?? []} />
          </p>
          <button type="button" className="btn-primary mt-8" onClick={() => setNewRun(true)}>
            Start a run <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <>
          <header className="grid items-start gap-x-14 gap-y-10 pb-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:pb-16">
            <div>
              <h1 className={cx('leading-[0.96] font-bold tracking-[-0.045em] [overflow-wrap:anywhere]', size)}>
                {lead}
                {rest && ' '}
                {rest && <span className="block">{rest}</span>}
              </h1>
              <div className="mt-6 max-w-[36ch] space-y-1 text-[18px] leading-[1.5] text-ink-2 md:mt-7 md:text-[20px]">
                {h.lines.map((line, i) => (
                  <p key={i}>
                    <Say parts={line} />
                  </p>
                ))}
              </div>
              <Controls bar={bar} suiteBar={v.suite.bar} total={total} objective={objective} onBar={setChoice} onObjective={setObjective} />
              {last && (
                <p className="mt-7 text-[13px] leading-relaxed text-faint">
                  <Link href={`/runs/${last.run_id}`} className="font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
                    Run {last.run_id}
                    {last.label ? `, ${last.label}` : ''}
                  </Link>{' '}
                  · {shortDate(last.created_at)} · {plural(v.models.length, 'model')} · {plural(total, 'example')}
                </p>
              )}
            </div>
            <div className="min-w-0">
              <FieldChart
                models={v.models}
                decision={d}
                objective={objective}
                onBar={setChoice}
                minBar={Math.min(MIN_BAR, Math.floor(v.suite.bar * 100) / 100)}
              />
              <p className="mt-1 pl-11 text-[13px] text-faint">Every dot is a model. Drag the line: the answer follows the bar.</p>
            </div>
          </header>

          <Section title="Every model" note="Sorted by how often each one is right. The bar is the line between them." first>
            <Ledger v={v} d={d} />
          </Section>

          <Caveats v={v} d={d} />

          <Section title="Task by task" note="One square per example. A red square is a miss.">
            <Evidence v={v} d={d} />
          </Section>

          <Section
            title="What the checks can't see"
            note="Checks grade what can be counted. Tone and judgement take a person, so answers are also compared blind, two at a time."
          >
            <Judges v={v} d={d} toJudge={toJudge} />
          </Section>

          <Section title="Would the answer hold?" note="The same rule, applied to every past run at the bar you set.">
            <p className="max-w-[60ch] text-[17px] leading-[1.5] text-ink-2">{holding(picks, d.pick, name)}</p>
            {v.history.length > 1 && (
              <div className="mt-7">
                <HistoryChart
                  models={v.models.map((m) => ({ id: m.id, label: m.label, color: m.color }))}
                  history={v.history.map((p) => ({
                    run_id: p.run_id,
                    label: p.label,
                    created_at: p.created_at,
                    models: Object.fromEntries(
                      Object.entries(p.models).map(([mid, m]) => [mid, { pass_rate: m.attempted ? m.passed / m.attempted : 0 }]),
                    ),
                  }))}
                  bar={bar}
                  picks={picks}
                  height={250}
                />
              </div>
            )}
            {board.data && <Changes board={board.data} models={v.models} />}
          </Section>

          <Section
            title="Test your own job"
            note={DEMO ? 'This demo replays recorded answers in your browser. Your own runs need the real thing.' : undefined}
          >
            <OwnJob />
          </Section>
        </>
      )}
      <NewRunModal open={newRun} onClose={() => setNewRun(false)} suiteId={id} />
    </div>
  );
}

/** Which job is on the sheet. A few jobs read as tabs; a long list becomes a menu. */
function Jobs({ suites, current, title }: { suites: SuiteSummary[]; current: string; title: string }) {
  const [, navigate] = useLocation();
  const listed = suites.some((s) => s.id === current) ? suites : [...suites, { id: current, title } as SuiteSummary];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
      <span className="label">The job</span>
      {listed.length <= 4 ? (
        listed.map((s) => (
          <Link
            key={s.id}
            href={`/verdict/${s.id}`}
            aria-current={s.id === current ? 'page' : undefined}
            className={cx(
              'text-[15px] font-semibold underline-offset-[7px] transition-colors',
              s.id === current ? 'text-ink underline decoration-2' : 'text-muted hover:text-ink',
            )}
          >
            {s.title}
          </Link>
        ))
      ) : (
        <div className="relative">
          <select
            aria-label="Job"
            className="input h-9 appearance-none py-0 pr-9 font-semibold"
            value={current}
            onChange={(e) => navigate(`/verdict/${e.target.value}`)}
          >
            {listed.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
        </div>
      )}
    </div>
  );
}

function Controls({
  bar,
  suiteBar,
  total,
  objective,
  onBar,
  onObjective,
}: {
  bar: number;
  suiteBar: number;
  total: number;
  objective: Objective;
  onBar: (bar: number | null) => void;
  onObjective: (o: Objective) => void;
}) {
  const id = useId();
  const value = Number((bar * 100).toFixed(1));
  // The slider reaches down to 50%, or to the job's own bar when that is set lower.
  const min = Math.min(Math.round(MIN_BAR * 100), Math.floor(suiteBar * 100));
  const changed = Math.abs(bar - suiteBar) > 1e-9;
  const text = `${share(bar)}: ${need(bar, total)} of ${total} right`;
  return (
    <div className="mt-9 max-w-[430px] border-t border-line pt-5 md:mt-11">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[14.5px] text-ink-2">
          Good enough is <span className="slab ml-0.5 text-[23px] text-ink">{share(bar)}</span>
          <span className="ml-2 text-muted">
            {need(bar, total)} of {total} right
          </span>
        </label>
        {changed && (
          <button type="button" className="link shrink-0 text-[13px]" onClick={() => onBar(null)}>
            Back to {share(suiteBar)}
          </button>
        )}
      </div>
      <input
        id={id}
        type="range"
        className="range mt-1.5"
        min={min}
        max={100}
        step={1}
        value={value}
        aria-valuetext={text}
        style={{ '--fill': `${Math.max(0, (value - min) / (100 - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onBar(Number(e.target.value) / 100)}
      />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14.5px] text-ink-2">
        Of the models that clear it, take the
        <Segmented
          size="sm"
          value={objective}
          onChange={onObjective}
          options={[
            { value: 'cost', label: 'Cheapest' },
            { value: 'speed', label: 'Fastest' },
          ]}
        />
      </div>
    </div>
  );
}

const COLS = 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.25fr)_0.7fr_0.65fr_minmax(0,1.55fr)] md:gap-x-7';

/** A measured figure in the slab, with its unit set small beside it: "625 ms", "1.9 s". */
function Figure({ text }: { text: string }) {
  const [n, ...unit] = text.split(' ');
  return (
    <>
      <span className="slab text-[18px] leading-none">{n}</span>
      {unit.length > 0 && <span className="text-[12.5px] text-muted"> {unit.join(' ')}</span>}
    </>
  );
}

/** Every model on one line each, the bar drawn between those that clear it and those that do not. */
function Ledger({ v, d }: { v: VerdictData; d: Decision }) {
  const total = Math.max(...v.models.map((m) => m.attempted));
  const clears = (m: VerdictModel) => Boolean(d.rows[m.id]?.clears);
  const rows = [...v.models.filter(clears), ...v.models.filter((m) => !clears(m))];
  const above = v.models.filter(clears).length;
  const rule = (
    <div className="relative h-0 border-t-2 border-ink">
      <span className="num absolute -top-[9px] right-0 bg-bg pl-3 text-[11.5px] leading-4 font-bold tracking-[0.07em] uppercase">
        The bar · {need(d.bar, total)} of {total}
      </span>
    </div>
  );
  return (
    <div>
      <div className={cx('label hidden pb-3 md:grid', COLS)}>
        <span>Model</span>
        <span>Right</span>
        <span>Per 1,000</span>
        <span>Median</span>
        <span>Verdict</span>
      </div>
      {rows.map((m, i) => {
        const s = standing(m, v.models, d);
        return (
          <Fragment key={m.id}>
            {i === above && rule}
            <div className={cx('grid grid-cols-2 items-center gap-x-4 gap-y-2.5 py-4', i !== above && 'border-t border-line', COLS)}>
              <div className="flex min-w-0 items-center gap-2.5">
                <ModelDot color={m.color} size={10} />
                <span className={cx('truncate text-[16px] tracking-[-0.01em]', s.kind === 'pick' ? 'font-bold' : 'font-semibold')}>{m.label}</span>
                {s.kind === 'pick' && <PenTick size={17} />}
              </div>
              <div className="order-3 col-span-2 flex items-center gap-3 md:order-none md:col-span-1">
                <span className="slab w-[2ch] shrink-0 text-right text-[23px] leading-none">{m.passed}</span>
                <span className="num shrink-0 text-[12.5px] text-muted">of {m.attempted}</span>
                <div className="relative h-[5px] min-w-[56px] flex-1 rounded-full bg-ink/[0.09]">
                  <div
                    className={cx('absolute inset-y-0 left-0 rounded-full', s.kind === 'short' ? 'bg-quiet' : 'bg-ink')}
                    style={{ width: `${m.pass_rate * 100}%` }}
                  />
                  <div className="absolute top-1/2 h-[13px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ink" style={{ left: `${d.bar * 100}%` }} />
                </div>
              </div>
              <div className="order-4 text-[15px] md:order-none">
                {m.cost === null ? <span className="text-faint">No price</span> : <Figure text={money(m.cost)} />}
                {m.cost !== null && <span className="text-[12.5px] text-muted md:hidden"> per 1,000</span>}
              </div>
              <div className="order-5 text-right text-[15px] md:order-none md:text-left">
                {m.latency_ms === null ? <span className="text-faint">Not timed</span> : <Figure text={ms(m.latency_ms)} />}
              </div>
              <div className="order-2 min-w-0 text-right md:order-none md:text-left">
                <div
                  className={cx(
                    'text-[14.5px]',
                    s.kind === 'pick' ? 'font-bold text-mark-ink' : s.kind === 'clears' ? 'font-semibold text-ink' : 'font-semibold text-muted',
                  )}
                >
                  {s.label}
                </div>
                {s.note && <div className="hidden text-[12.5px] leading-snug text-faint md:block">{s.note}</div>}
              </div>
              {s.note && <div className="order-6 col-span-2 -mt-1 text-[12.5px] leading-snug text-faint md:hidden">{s.note}</div>}
            </div>
          </Fragment>
        );
      })}
      {above === rows.length && rule}
    </div>
  );
}

/** What to know about the pick before it ships: its margin, the sample, the bill at scale, and what it gets wrong. */
function Caveats({ v, d }: { v: VerdictData; d: Decision }) {
  const by = new Map(v.models.map((m) => [m.id, m]));
  const pick = d.pick === null ? undefined : by.get(d.pick);
  const best = d.best === null ? undefined : by.get(d.best);
  const m = pick ?? best;
  if (!m) return null;
  const row = d.rows[m.id];
  const misses = v.suite.tasks.filter((t) => m.tasks[t.id] && !m.tasks[t.id].ok);
  const rival = best && best.id !== m.id && best.pass_rate > m.pass_rate ? best : undefined;
  const rescued = rival ? misses.filter((t) => rival.tasks[t.id]?.ok).length : 0;
  const million = (x: number) => money(x * 1000);

  const points: { lead: string; text: ReactNode }[] = [];
  if (row.margin === 0) {
    points.push({
      lead: 'Nothing to spare.',
      text: `It needs ${row.need} of ${m.attempted} and gets exactly ${m.passed}. One more miss and it is under the bar.`,
    });
  } else if (row.margin > 0) {
    points.push({ lead: `${row.margin} to spare.`, text: `It needs ${row.need} of ${m.attempted} and gets ${m.passed}.` });
  } else {
    points.push({ lead: `${-row.margin} short.`, text: `It needs ${row.need} of ${m.attempted} and gets ${m.passed}.` });
  }
  if (m.interval) {
    // The range is always worth printing; it is only a warning while it is wide.
    const wide = m.interval[1] - m.interval[0] >= 0.1;
    const [low, high] = [pct(m.interval[0]), pct(m.interval[1])];
    points.push({
      lead: wide ? 'A small sample.' : 'A tight range.',
      text: wide
        ? `On ${plural(m.attempted, 'example')} its true pass rate could be anywhere from ${low} to ${high}. More examples tighten it.`
        : `On ${plural(m.attempted, 'example')} its true pass rate is between ${low} and ${high}.`,
    });
  }
  if (m.cost === null) {
    points.push({
      lead: 'No price yet.',
      text: (
        <>
          Cost was left out of the comparison.{' '}
          <Link href="/models" className="link">
            Set its price
          </Link>{' '}
          to bring it in.
        </>
      ),
    });
  } else {
    const other = rival && rival.cost ? ` ${rival.label} would cost ${million(rival.cost)} for the same work.` : '';
    points.push({
      lead: 'At scale.',
      text: m.cost === 0 ? `A million answers add nothing to an API bill.${other}` : `A million answers cost ${million(m.cost)}.${other}`,
    });
  }

  return (
    <Section
      title={pick ? 'Before you ship it' : 'How close it got'}
      note={pick ? `What to know about ${m.label} first.` : `${m.label} comes closest to the bar.`}
    >
      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
        <dl className="space-y-5">
          {points.map((p) => (
            <div key={p.lead}>
              <dt className="text-[16px] font-bold tracking-[-0.01em]">{p.lead}</dt>
              <dd className="mt-1 max-w-[46ch] text-[15px] leading-[1.55] text-ink-2">{p.text}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-[16px] font-bold tracking-[-0.01em]">
            {misses.length === 0
              ? 'It gets every example right.'
              : misses.length === 1
                ? 'The one it gets wrong'
                : `The ${misses.length} it gets wrong`}
          </h3>
          {misses.length > 0 && (
            <div className="mt-3 divide-y divide-line border-y border-line">
              {misses.map((t) => (
                <Link
                  key={t.id}
                  href={`/runs/${m.run_id}/tasks/${t.id}`}
                  className="group flex items-baseline gap-3 py-3 text-[14.5px] hover:bg-ink/[0.025]"
                >
                  <span className="mt-[7px] h-2 w-2 shrink-0 self-start rounded-[2px] bg-mark" />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{t.title}</span>
                    <span className="block text-[13.5px] text-muted">
                      Fails the check <span className="text-mark-ink">{m.tasks[t.id].why || 'a check'}</span>
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-[12.5px] text-faint capitalize sm:inline">{t.category}</span>
                  <ArrowRight
                    size={14}
                    className="shrink-0 self-center text-quiet transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </Link>
              ))}
            </div>
          )}
          {rival && misses.length > 0 && (
            <p className="mt-3 text-[13.5px] text-muted">
              {rescued === misses.length
                ? `${rival.label} gets ${misses.length === 1 ? 'it' : misses.length === 2 ? 'both' : `all ${misses.length}`} right.`
                : `${rival.label} gets ${rescued} of these ${misses.length} right.`}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

/** Every model against every example. Pick a column to see who missed it and why. */
function Evidence({ v, d }: { v: VerdictData; d: Decision }) {
  const groups = useMemo(() => {
    const out: { category: string; tasks: VerdictData['suite']['tasks'] }[] = [];
    for (const t of v.suite.tasks) {
      const g = out.find((o) => o.category === t.category);
      if (g) g.tasks.push(t);
      else out.push({ category: t.category, tasks: [t] });
    }
    return out;
  }, [v.suite.tasks]);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const pick = v.models.find((m) => m.id === d.pick);
  const missedBy = (taskId: string) => v.models.filter((m) => m.tasks[taskId] && !m.tasks[taskId].ok);
  const opening =
    v.suite.tasks.find((t) => pick && pick.tasks[t.id] && !pick.tasks[t.id].ok) ??
    v.suite.tasks.find((t) => missedBy(t.id).length) ??
    v.suite.tasks[0];
  const shownId = hover ?? pinned ?? opening?.id;
  const shown = v.suite.tasks.find((t) => t.id === shownId);
  const failed = shown ? missedBy(shown.id) : [];
  const reader = shown ? ((pick && pick.tasks[shown.id] ? pick : undefined) ?? failed[0] ?? v.models.find((m) => m.tasks[shown.id])) : undefined;

  const names = (className: string) => (
    <div className={cx('shrink-0 flex-col gap-1 pt-7', className)}>
      {v.models.map((m) => (
        <div key={m.id} className="flex h-6 items-center gap-2">
          <ModelDot color={m.color} size={8} />
          <span className={cx('truncate text-[13.5px]', m.id === d.pick ? 'font-bold text-ink' : 'font-medium text-ink-2')}>{m.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {v.suite.description && <p className="mb-8 max-w-[72ch] text-[15px] leading-[1.6] text-ink-2">{v.suite.description}</p>}
      <div className="flex flex-col gap-x-2 gap-y-6 md:flex-row">
        {names('hidden w-[132px] md:flex')}
        {groups.map((g) => (
          <div key={g.category} className="flex min-w-0 gap-2" style={{ flex: `${g.tasks.length} 1 0` }}>
            {names('flex w-[92px] md:hidden')}
            <div className="min-w-0 flex-1">
              <div className="label mb-2 flex h-5 items-baseline gap-1.5 px-[3px]">
                {titleCase(g.category)} <span className="num font-medium text-faint">{g.tasks.length}</span>
              </div>
              <div className="flex">
                {g.tasks.map((t) => {
                  const active = t.id === shownId;
                  const misses = missedBy(t.id).length;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={t.id === pinned}
                      aria-label={`${t.title}: ${misses ? `${plural(misses, 'model')} missed it` : 'every model passed'}`}
                      onMouseEnter={() => setHover(t.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(t.id)}
                      onBlur={() => setHover(null)}
                      onClick={() => setPinned(t.id === pinned ? null : t.id)}
                      className={cx(
                        'flex min-w-0 flex-1 flex-col gap-1 rounded-[5px] px-[2px] py-[3px] -my-[3px] transition-colors md:px-[3px]',
                        active ? 'bg-ink/[0.08]' : 'hover:bg-ink/[0.05]',
                        t.id === pinned && 'ring-1 ring-ink/35',
                      )}
                    >
                      {v.models.map((m) => {
                        const cell = m.tasks[t.id];
                        return (
                          <span
                            key={m.id}
                            className={cx(
                              'block h-6 w-full rounded-[3px]',
                              !cell ? 'border border-dashed border-line-2' : cell.ok ? 'bg-ink/[0.13]' : 'bg-mark',
                            )}
                          />
                        );
                      })}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {shown && (
        <div className="mt-7 min-h-[104px] border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[16px] font-bold tracking-[-0.01em]">{shown.title}</span>
            <span className="text-[12.5px] text-faint capitalize">{shown.category}</span>
            {reader && (
              <Link href={`/runs/${reader.run_id}/tasks/${shown.id}`} className="link ml-auto inline-flex items-center gap-1 text-[13.5px]">
                Read the answers <ArrowRight size={13} />
              </Link>
            )}
          </div>
          {failed.length === 0 ? (
            <p className="mt-2 text-[14.5px] text-muted">Every model gets this one right.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-x-7 gap-y-1.5 text-[14.5px]">
              {failed.map((m) => (
                <li key={m.id} className="flex items-baseline gap-2">
                  <span className="translate-y-[-1px]">
                    <ModelDot color={m.color} size={8} />
                  </span>
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-muted">
                    fails <span className="text-mark-ink">{m.tasks[shown.id].why || 'a check'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Blind judging: who people prefer, how sure that is, and whether it agrees with the pick. */
function Judges({ v, d, toJudge }: { v: VerdictData; d: Decision; toJudge: number }) {
  const rated = v.models
    .filter((m) => v.human.models[String(m.id)])
    .map((m) => ({ m, h: v.human.models[String(m.id)] }))
    .sort((a, b) => b.h.rating - a.h.rating);
  const lo = Math.min(...rated.map((r) => r.h.ci?.[0] ?? r.h.rating), 900);
  const hi = Math.max(...rated.map((r) => r.h.ci?.[1] ?? r.h.rating), 1100);
  const domain: [number, number] = [Math.floor((lo - 20) / 50) * 50, Math.ceil((hi + 20) / 50) * 50];
  const cta = (
    <Link href={`/rate?suite=${encodeURIComponent(v.suite.id)}`} className="btn-ghost">
      {toJudge > 0 ? `Judge ${plural(toJudge, 'pair')}` : 'Judge blind'} <ArrowRight size={15} />
    </Link>
  );
  return (
    <div>
      <div className="max-w-[60ch] space-y-1 text-[17px] leading-[1.5] text-ink-2">
        {judges(v.models, v.human, d.pick).map((line, i) => (
          <p key={i}>
            <Say parts={line} />
          </p>
        ))}
      </div>
      {rated.length < 2 ? (
        <div className="mt-6">{cta}</div>
      ) : (
        <div className="mt-8 grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <div>
            <div
              className="label flex items-baseline justify-between pb-2.5"
              title="A Bradley-Terry rating fitted to every blind verdict, with a 95% bootstrap interval. 1000 is the average model; 400 points is 10 to 1 odds of being preferred."
            >
              <span>Rating, with its 95% range</span>
              <span className="num font-medium normal-case tracking-normal text-faint">1000 is average</span>
            </div>
            {rated.map(({ m, h }) => (
              <div
                key={m.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-line py-3 sm:grid-cols-[112px_52px_minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <ModelDot color={m.color} size={9} />
                  <span className={cx('truncate text-[15px]', m.id === d.pick ? 'font-bold' : 'font-semibold')}>{m.label}</span>
                </div>
                <div className="slab text-right text-[22px] leading-none sm:text-left">{Math.round(h.rating).toLocaleString('en-US')}</div>
                <div className="col-span-2 sm:col-span-1">
                  <RatingBar rating={h.rating} ci={h.ci} domain={domain} color={m.color} />
                </div>
                <div className="num col-span-2 text-[12.5px] whitespace-nowrap text-muted sm:col-span-1 sm:text-right">
                  {h.win_rate === null ? `${h.games} pairs` : `won ${pct(h.win_rate)} of ${h.games}`}
                </div>
              </div>
            ))}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-6">
              {cta}
              <span className="text-[13.5px] text-muted">{plural(v.human.count, 'rating')} so far. Each one narrows the ranges.</span>
            </div>
          </div>
          <div className="min-w-0">
            <div className="label pb-2.5">Head to head</div>
            <WinMatrix models={rated.map(({ m }) => ({ id: m.id, label: m.label, color: m.color }))} h2h={v.human.h2h} />
          </div>
        </div>
      )}
    </div>
  );
}

const KIND: Record<string, { label: string; tone: string }> = {
  regression: { label: 'now fails', tone: 'text-mark-ink' },
  fixed: { label: 'now passes', tone: 'text-good' },
  errored: { label: 'now errors', tone: 'text-serious' },
  task_changed: { label: 'task edited', tone: 'text-muted' },
};

/** What moved between each model's last two runs, one line per example that changed. */
function Changes({ board, models }: { board: Board; models: VerdictModel[] }) {
  const by = new Map(models.map((m) => [m.id, m]));
  const known = board.regressions.filter((r) => by.has(r.model_id));
  if (!known.length) return null;
  const rows = known.flatMap((r) => r.changes.map((c) => ({ r, c, m: by.get(r.model_id)! })));
  const steady = known.filter((r) => !r.changes.length).map((r) => by.get(r.model_id)!.label);
  return (
    <div className="mt-10">
      <h3 className="text-[16px] font-bold tracking-[-0.01em]">Since the run before</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[14.5px] text-muted">Same verdict on every example, for every model.</p>
      ) : (
        <div className="mt-3 divide-y divide-line border-y border-line">
          {rows.map(({ r, c, m }) => (
            <Link
              key={`${m.id}:${c.task_id}`}
              href={`/runs/${r.to_run}/tasks/${c.task_id}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-5 gap-y-0.5 py-2.5 text-[14.5px] hover:bg-ink/[0.025] sm:grid-cols-[150px_minmax(0,1fr)_auto_92px]"
            >
              <span className="flex min-w-0 items-center gap-2.5 font-semibold">
                <ModelDot color={m.color} size={8} /> <span className="truncate">{m.label}</span>
              </span>
              <span className="order-3 col-span-2 min-w-0 truncate text-ink-2 sm:order-none sm:col-span-1">
                {board.task_titles[c.task_id] ?? c.task_id}
              </span>
              <span className="hidden text-[12.5px] text-faint capitalize sm:inline">{c.category}</span>
              <span className={cx('text-right text-[13.5px] font-semibold', KIND[c.kind]?.tone)}>{KIND[c.kind]?.label ?? c.kind}</span>
            </Link>
          ))}
        </div>
      )}
      {rows.length > 0 && steady.length > 0 && <p className="mt-3 text-[13.5px] text-muted">No change for {steady.join(', ')}.</p>}
    </div>
  );
}

const STEPS: { title: string; text: string; href: string; cta: string }[] = [
  {
    title: 'Write down the job',
    text: 'A suite is a file of your real examples and the checks an answer has to pass: the right label, a word limit, a phrase it must never say, a Python test.',
    href: '/suites',
    cta: 'Suites',
  },
  {
    title: 'Add the candidates',
    text: 'Any model with an API, hosted or on your own machine. Give each one a price and cost joins the comparison.',
    href: '/models',
    cta: 'Models',
  },
  {
    title: 'Run it, read the verdict',
    text: 'Every answer is graded the same way. The cheapest model that clears your bar is named, with every miss one click away.',
    href: '/runs',
    cta: 'Runs',
  },
];

function Steps() {
  return (
    <ol className="grid gap-x-10 gap-y-9 md:grid-cols-3">
      {STEPS.map((s, i) => (
        <li key={s.title}>
          <div className="slab text-[46px] leading-none text-line-2">{i + 1}</div>
          <div className="mt-3 text-[17px] font-bold tracking-[-0.01em]">{s.title}</div>
          <p className="mt-1.5 max-w-[40ch] text-[14.5px] leading-[1.55] text-ink-2">{s.text}</p>
          <Link href={s.href} className="link mt-3 inline-flex items-center gap-1 text-[14px]">
            {s.cta} <ArrowRight size={14} />
          </Link>
        </li>
      ))}
    </ol>
  );
}

const COMMAND: [string, string?][] = [
  ['evalbench run triage.yaml \\'],
  ['  --model anthropic:claude-haiku-5-5 \\'],
  ['  --model openai-compatible:qwen3-8b@', 'http://localhost:1234/v1 \\'],
  ['  --bar 0.9 --require-pick'],
];

function OwnJob() {
  return (
    <div>
      <Steps />
      <div className="mt-10 border-t border-line pt-6">
        <div className="text-[14.5px] text-ink-2">
          The same verdict from a terminal or a CI job. It exits non-zero when no model clears the bar, so a release can wait on it.
        </div>
        {/* One block per line of the command: on a phone a long line folds after the @, under a hanging indent. */}
        <pre className="mt-3 rounded-[10px] bg-ink/[0.05] px-4 py-3.5 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap text-ink sm:text-[13px]">
          {COMMAND.map(([head, tail]) => (
            <span key={head} className="block pl-[6ch] -indent-[6ch]">
              {head}
              {tail && <wbr />}
              {tail}
            </span>
          ))}
        </pre>
        {DEMO && (
          <a href={REPO_URL} className="link mt-4 inline-flex items-center gap-1 text-[14px]">
            Get Evalbench on GitHub <ArrowRight size={14} />
          </a>
        )}
      </div>
    </div>
  );
}

/** Before the first run: what this is, the three steps, and a way to see it with data. */
function Start() {
  const qc = useQueryClient();
  const demo = useMutation({ mutationFn: () => api.post('/demo'), onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="animate-rise">
      <h1 className="max-w-[15ch] text-[46px] leading-[0.98] font-bold tracking-[-0.045em] text-balance md:text-[76px]">
        Which model should do this job?
      </h1>
      <p className="mt-7 max-w-[52ch] text-[18px] leading-[1.5] text-ink-2 md:text-[20px]">
        Evalbench runs your real examples through every candidate, checks each answer, and names the cheapest model that is good enough. With the
        proof.
      </p>
      <div className="mt-14 border-t-2 border-ink pt-10">
        <Steps />
      </div>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-x-10 gap-y-5 rounded-[18px] bg-ink px-7 py-6 text-panel">
        <div>
          <div className="text-[18px] font-bold tracking-[-0.01em]">See it with data first</div>
          <div className="mt-1 text-[14.5px] opacity-75">Nine runs, five fictional models and 239 blind ratings across two jobs. No keys needed.</div>
        </div>
        <button type="button" className="btn h-11 bg-panel px-5 text-ink hover:bg-panel-2" disabled={demo.isPending} onClick={() => demo.mutate()}>
          {demo.isPending ? 'Setting the table' : 'Load the demo workspace'}
        </button>
      </div>
      <ErrorNote error={demo.error} />
    </div>
  );
}
