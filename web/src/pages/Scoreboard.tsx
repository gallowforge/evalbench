import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, Info } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { api, type Board, type SuiteSummary } from '../api';
import { CategoryBars, HistoryChart, RatingBar, WinMatrix } from '../components/charts';
import { Card, cx, Empty, ErrorNote, Loading, ModelDot, PageHeader } from '../components/ui';
import { ms, pct, plural } from '../lib/format';
import { tone } from '../lib/theme';

const KIND: Record<string, { label: string; tone: string }> = {
  regression: { label: 'now fails', tone: 'text-mark-ink' },
  fixed: { label: 'now passes', tone: 'text-good' },
  errored: { label: 'now errors', tone: 'text-serious' },
  task_changed: { label: 'task edited', tone: 'text-muted' },
};

export function Scoreboard({ suite }: { suite?: string }) {
  const [, navigate] = useLocation();
  const suites = useQuery({ queryKey: ['suites'], queryFn: () => api.get<SuiteSummary[]>('/suites') });
  const withRuns = suites.data?.filter((s) => s.runs > 0) ?? [];
  const current = suite ?? withRuns[0]?.id;
  const q = useQuery({
    queryKey: ['board', current],
    queryFn: () => api.get<Board>(`/scoreboard/${current}`),
    enabled: !!current,
    refetchInterval: 10_000,
  });

  if (suites.isLoading || (current && q.isLoading)) return <Loading />;
  const title = suites.data?.find((s) => s.id === current)?.title ?? current;
  const header = (
    <PageHeader
      title="Scoreboard"
      subtitle="What the checks say and what the judges say, side by side, and how both move from run to run."
      actions={
        withRuns.length > 1 ? (
          <div className="relative">
            <select
              className="input h-10 appearance-none py-0 pr-9 font-medium"
              value={current}
              onChange={(e) => navigate(`/scoreboard/${e.target.value}`)}
            >
              {withRuns.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
          </div>
        ) : null
      }
    />
  );
  if (!current) {
    return (
      <>
        {header}
        <div className="card">
          <Empty
            icon={<BarChart3 size={20} />}
            title="No results yet"
            action={
              <Link href="/runs" className="btn-primary">
                Start a run
              </Link>
            }
          >
            Scores appear here after the first run of a suite.
          </Empty>
        </div>
      </>
    );
  }
  if (q.error)
    return (
      <>
        {header}
        <ErrorNote error={q.error} />
      </>
    );
  const b = q.data!;
  const rated = b.models.filter((m) => m.human);
  const lo = Math.min(...rated.map((m) => m.human!.ci?.[0] ?? m.human!.rating), 900);
  const hi = Math.max(...rated.map((m) => m.human!.ci?.[1] ?? m.human!.rating), 1100);
  const domain: [number, number] = [Math.floor((lo - 20) / 50) * 50, Math.ceil((hi + 20) / 50) * 50];
  const modelById = new Map(b.models.map((m) => [m.id, m]));

  return (
    <>
      {header}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 px-7 pt-6">
          <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
          <span className="text-[13.5px] text-muted">
            {plural(b.runs, 'run')} · {plural(b.ratings, 'blind verdict')}
          </span>
        </div>
        {/* Wider than a phone: it scrolls sideways, and takes focus so a keyboard can scroll it. */}
        <div className="overflow-x-auto px-3 pb-3" tabIndex={0} role="region" aria-label={`${title} scoreboard`}>
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="text-[12.5px] font-semibold text-muted">
                <th className="w-12 px-4 py-4 font-semibold" />
                <th className="px-4 py-4 font-semibold">Model</th>
                <th className="px-4 py-4 font-semibold">Checks passed</th>
                <th className="w-[290px] px-4 py-4 font-semibold">
                  <span
                    className="inline-flex items-center gap-1"
                    title="A Bradley-Terry rating fitted to every blind verdict, with a 95% bootstrap interval. 1000 is the average model; 400 points is 10 to 1 odds of being preferred."
                  >
                    Judges, with 95% interval <Info size={12} />
                  </span>
                </th>
                <th className="px-4 py-4 text-right font-semibold">Picked</th>
                <th className="px-4 py-4 text-right font-semibold">Median</th>
              </tr>
            </thead>
            <tbody>
              {b.models.map((m, i) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-5">
                    <span className="slab text-[26px] leading-none font-semibold text-faint">{i + 1}</span>
                  </td>
                  <td className="px-4 py-5">
                    <div className="flex items-center gap-2.5">
                      <ModelDot color={m.color} size={10} />
                      <div className="min-w-0">
                        <div className="truncate text-[16.5px] font-semibold tracking-[-0.01em]">{m.label}</div>
                        {m.model && <div className="truncate font-mono text-[11.5px] text-faint">{m.model}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="slab text-[32px] leading-none font-semibold">{pct(m.auto?.pass_rate)}</span>
                      {m.auto && (
                        <span className="text-[13px] text-muted">
                          {m.auto.passed} of {m.auto.attempted} · run #{m.auto.run_id}
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5 h-[5px] max-w-[220px] overflow-hidden rounded-full bg-ink/[0.07]">
                      <div className="h-full rounded-full" style={{ width: `${(m.auto?.pass_rate ?? 0) * 100}%`, background: tone(m.color) }} />
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    {m.human ? (
                      <div className="flex items-center gap-4">
                        <span className="slab w-14 text-[26px] leading-none font-semibold">{Math.round(m.human.rating)}</span>
                        <RatingBar rating={m.human.rating} ci={m.human.ci} domain={domain} color={m.color} />
                      </div>
                    ) : (
                      <span className="text-[13.5px] text-faint">not judged yet</span>
                    )}
                  </td>
                  <td className="px-4 py-5 text-right">
                    {m.human ? (
                      <>
                        <span className="num text-[15px] font-semibold">{pct(m.human.win_rate)}</span>
                        <div className="text-[12px] text-muted">of {m.human.games}</div>
                      </>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </td>
                  <td className="px-4 py-5 text-right text-[14.5px] text-ink-2">{ms(m.auto?.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card title="Pass rate over time" className="min-w-0">
          <HistoryChart board={b} height={300} />
        </Card>
        <Card title="By category" action={<span className="text-[12.5px] text-muted">latest run per model</span>}>
          <CategoryBars board={b} />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card title="What changed" action={<span className="text-[12.5px] text-muted">each model, latest run against the one before</span>}>
          {b.regressions.length === 0 && <div className="py-6 text-center text-[14px] text-muted">Each model needs two runs of this suite.</div>}
          <div className="space-y-6">
            {b.regressions.map((r) => {
              const m = modelById.get(r.model_id);
              if (!m) return null;
              return (
                <div key={r.model_id}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[15px] font-semibold">
                      <ModelDot color={m.color} /> {m.label}
                    </span>
                    <span className="num text-[12.5px] text-muted">
                      <Link href={`/runs/${r.from_run}`} className="hover:text-ink">
                        run {r.from_run}
                      </Link>{' '}
                      to{' '}
                      <Link href={`/runs/${r.to_run}`} className="hover:text-ink">
                        run {r.to_run}
                      </Link>
                    </span>
                  </div>
                  {r.changes.length === 0 ? (
                    <div className="text-[13.5px] text-muted">Same verdict on every task.</div>
                  ) : (
                    <div className="divide-y divide-line border-y border-line">
                      {r.changes.map((c) => (
                        <Link
                          key={c.task_id}
                          href={`/runs/${r.to_run}/tasks/${c.task_id}`}
                          className="flex items-center gap-3 py-2.5 text-[14px] hover:bg-ink/[0.025]"
                        >
                          <span className="min-w-0 flex-1 truncate text-ink-2">{b.task_titles[c.task_id] ?? c.task_id}</span>
                          <span className="text-[12px] capitalize text-faint">{c.category}</span>
                          <span className={cx('w-[86px] text-right text-[13px] font-semibold', KIND[c.kind]?.tone)}>{KIND[c.kind]?.label}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Head to head" action={<span className="text-[12.5px] text-muted">blind verdicts only</span>}>
          <WinMatrix board={b} />
        </Card>
      </div>
    </>
  );
}
