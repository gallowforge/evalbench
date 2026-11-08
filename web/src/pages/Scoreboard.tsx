import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { api, type Board, type SuiteSummary } from '../api';
import { CategoryBars, HistoryChart, RatingBar, WinMatrix } from '../components/charts';
import { Card, cx, Empty, ErrorNote, Loading, ModelDot, PageHeader } from '../components/ui';
import { ms, pct, plural } from '../lib/format';

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
      subtitle="Automatic checks and blind human preference side by side, and how both move over time."
      actions={
        withRuns.length > 1 ? (
          <div className="relative">
            <select className="input h-9 appearance-none py-0 pr-8" value={current} onChange={(e) => navigate(`/scoreboard/${e.target.value}`)}>
              {withRuns.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
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
            icon={<BarChart3 size={18} />}
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
      <Card
        title={
          <span>
            {title}{' '}
            <span className="font-normal text-faint">
              · {plural(b.runs, 'run')} · {plural(b.ratings, 'rating')}
            </span>
          </span>
        }
        pad={false}
      >
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[11px] font-medium uppercase tracking-[0.07em] text-faint">
                <th className="w-10 px-3 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Model</th>
                <th className="px-3 py-3 font-medium">Checks passed</th>
                <th className="px-3 py-3 text-right font-medium">Score</th>
                <th className="w-[230px] px-3 py-3 font-medium">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Bradley-Terry rating from blind pairwise preferences, with a 95% bootstrap interval. 1000 is the average model; +400 means 10:1 odds of being preferred."
                  >
                    Human rating <Info size={11} />
                  </span>
                </th>
                <th className="px-3 py-3 text-right font-medium">Win rate</th>
                <th className="px-3 py-3 text-right font-medium">Median latency</th>
              </tr>
            </thead>
            <tbody>
              {b.models.map((m, i) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="num px-3 py-3.5 text-[13px] text-faint">{i + 1}</td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <ModelDot color={m.color} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{m.label}</div>
                        {m.model && <div className="truncate font-mono text-[11px] text-faint">{m.model}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="h-[7px] w-full max-w-[200px] overflow-hidden rounded-full bg-white/[0.05]">
                        <div className="h-full rounded-full" style={{ width: `${(m.auto?.pass_rate ?? 0) * 100}%`, background: m.color }} />
                      </div>
                      <span className="slab w-12 text-right text-[17px] font-bold">{pct(m.auto?.pass_rate)}</span>
                    </div>
                    {m.auto && (
                      <div className="num mt-1 text-[11px] text-faint">
                        {m.auto.passed}/{m.auto.attempted} tasks · run #{m.auto.run_id}
                      </div>
                    )}
                  </td>
                  <td className="num px-3 py-3.5 text-right text-[13px] text-ink-2">
                    {m.auto?.mean_score !== undefined && m.auto?.mean_score !== null ? m.auto.mean_score.toFixed(2) : '–'}
                  </td>
                  <td className="px-3 py-3.5">
                    {m.human ? (
                      <div className="flex items-center gap-3">
                        <span className="slab w-12 text-[17px] font-bold">{Math.round(m.human.rating)}</span>
                        <RatingBar rating={m.human.rating} ci={m.human.ci} domain={domain} color={m.color} />
                      </div>
                    ) : (
                      <span className="text-[12px] text-faint">not rated yet</span>
                    )}
                  </td>
                  <td className="num px-3 py-3.5 text-right text-[13px] text-ink-2">
                    {m.human ? (
                      <>
                        {pct(m.human.win_rate)} <span className="text-[11px] text-faint">of {m.human.games}</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num px-3 py-3.5 text-right text-[13px] text-ink-2">{ms(m.auto?.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Pass rate over time">
          <HistoryChart board={b} />
        </Card>
        <Card title="By category" action={<span className="text-[11.5px] text-faint">latest run per model</span>}>
          <CategoryBars board={b} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Regressions" action={<span className="text-[11.5px] text-faint">latest run vs the one before, per model</span>}>
          {b.regressions.length === 0 && <div className="py-6 text-center text-[13px] text-muted">Each model needs two runs of this suite.</div>}
          <div className="space-y-4">
            {b.regressions.map((r) => {
              const m = modelById.get(r.model_id);
              if (!m) return null;
              return (
                <div key={r.model_id}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <ModelDot color={m.color} /> {m.label}
                    </span>
                    <span className="num text-[11.5px] text-faint">
                      <Link href={`/runs/${r.from_run}`} className="hover:text-ink">
                        #{r.from_run}
                      </Link>{' '}
                      →{' '}
                      <Link href={`/runs/${r.to_run}`} className="hover:text-ink">
                        #{r.to_run}
                      </Link>
                    </span>
                  </div>
                  {r.changes.length === 0 ? (
                    <div className="rounded-[9px] border border-line px-3 py-2 text-[12.5px] text-faint">Same results on every task.</div>
                  ) : (
                    <div className="space-y-1">
                      {r.changes.map((c) => (
                        <Link
                          key={c.task_id}
                          href={`/runs/${r.to_run}/tasks/${c.task_id}`}
                          className={cx(
                            'flex items-center gap-2.5 rounded-[9px] border px-3 py-2 text-[12.5px] transition-colors hover:brightness-125',
                            c.kind === 'regression'
                              ? 'border-bad/25 bg-bad/[0.07]'
                              : c.kind === 'fixed'
                                ? 'border-good/25 bg-good/[0.06]'
                                : 'border-line bg-white/[0.02]',
                          )}
                        >
                          {c.kind === 'regression' ? (
                            <TrendingDown size={14} className="text-bad-ink" />
                          ) : c.kind === 'fixed' ? (
                            <TrendingUp size={14} className="text-good-ink" />
                          ) : (
                            <Info size={14} className="text-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-ink-2">{b.task_titles[c.task_id] ?? c.task_id}</span>
                          <span className="text-[11px] capitalize text-faint">{c.category}</span>
                          <span
                            className={cx(
                              'w-[74px] text-right text-[11.5px] font-medium',
                              c.kind === 'regression' ? 'text-bad-ink' : c.kind === 'fixed' ? 'text-good-ink' : 'text-muted',
                            )}
                          >
                            {c.kind === 'regression'
                              ? 'now fails'
                              : c.kind === 'fixed'
                                ? 'now passes'
                                : c.kind === 'errored'
                                  ? 'now errors'
                                  : 'task edited'}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Head to head" action={<span className="text-[11.5px] text-faint">blind pairwise preferences</span>}>
          <WinMatrix board={b} />
        </Card>
      </div>
    </>
  );
}
