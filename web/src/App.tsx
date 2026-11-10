import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { api, type Overview as OverviewData } from './api';
import { Logo } from './components/Logo';
import { ThemeMenu } from './components/ThemeMenu';
import { cx, Loading, NotFound } from './components/ui';
import { DEMO, REPO_URL } from './lib/demo';
import { useMeta, useRater } from './lib/hooks';
import { Compare } from './pages/Compare';
import { DataPage } from './pages/Data';
import { Models } from './pages/Models';
import { Rate } from './pages/Rate';
import { RunDetailPage } from './pages/RunDetail';
import { Runs } from './pages/Runs';
import { SettingsPage } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { SuiteDetail } from './pages/SuiteDetail';
import { Suites } from './pages/Suites';
import { Verdict } from './pages/Verdict';

/** The verdict is the home page, and each job's verdict lives under /verdict. */
const NAV: { href: string; label: string; also?: string }[] = [
  { href: '/', label: 'Verdict', also: '/verdict' },
  { href: '/rate', label: 'Judge' },
  { href: '/runs', label: 'Runs' },
  { href: '/suites', label: 'Suites' },
  { href: '/models', label: 'Models' },
];

function NavLink({ href, label, also, badge }: { href: string; label: string; also?: string; badge?: ReactNode }) {
  const [location] = useLocation();
  const under = (base: string) => location === base || location.startsWith(`${base}/`);
  const active = href === '/' ? location === '/' || Boolean(also && under(also)) : under(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-11 shrink-0 items-center gap-1.5 text-[14.5px] font-semibold transition-colors md:h-16',
        active ? 'text-ink' : 'text-muted hover:text-ink',
      )}
    >
      {label}
      {badge}
      {active && <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-t-full bg-ink" />}
    </Link>
  );
}

function TopBar() {
  const meta = useMeta();
  const [rater] = useRater();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview'), refetchInterval: 15_000 });
  const toJudge = overview.data?.rating.reduce((n, r) => n + r.remaining, 0) ?? 0;
  // On a narrow screen the nav scrolls sideways: keep the page you are on in view.
  const nav = useRef<HTMLElement>(null);
  const [location] = useLocation();
  useEffect(() => {
    const n = nav.current;
    const el = n?.querySelector('[aria-current="page"]');
    if (!n || !el) return;
    const a = el.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) n.scrollLeft += a.left - b.left - 16;
  }, [location]);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      {/* On a phone the sections get a row of their own, so every one of them is in sight. */}
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 px-5 md:flex-nowrap md:px-10">
        <Link href="/" className="flex h-14 shrink-0 items-center gap-2.5 md:h-16">
          <Logo size={28} />
          <span className="text-[17px] font-bold tracking-[-0.02em]">Evalbench</span>
        </Link>
        <nav
          ref={nav}
          aria-label="Main"
          className="order-last -mx-5 -mb-px flex w-[calc(100%+2.5rem)] gap-6 overflow-x-auto px-5 [scrollbar-width:none] md:order-none md:mx-0 md:w-auto md:min-w-0 md:flex-1 md:px-0"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.href}
              {...n}
              badge={
                n.href === '/rate' && toJudge > 0 ? (
                  <span className="num rounded-full bg-mark px-1.5 text-[11px] leading-[18px] font-bold text-white">{toJudge}</span>
                ) : null
              }
            />
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {meta.data?.demo && !DEMO && (
            <span
              className="hidden text-[12.5px] font-semibold text-muted lg:inline"
              title="Fictional models with scripted answers, graded for real."
            >
              Demo workspace
            </span>
          )}
          {rater && (
            <span className="hidden text-[13px] text-muted lg:inline">
              Judging as <span className="font-semibold text-ink">{rater}</span>
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <ThemeMenu />
            <Link href="/data" className="btn-quiet h-9 w-9 p-0" aria-label="Data" title="Data: export and import">
              <Database size={16} />
            </Link>
            <Link href="/settings" className="btn-quiet h-9 w-9 p-0" aria-label="Settings" title="Settings">
              <SettingsIcon size={17} />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

/** The static demo's one standing notice: always in sight, as quiet as the bar at the top. */
function DemoNotice() {
  return (
    <aside
      aria-label="About this demo"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-2 text-[12.5px] text-muted md:px-10">
        <p className="min-w-0">
          <span className="font-semibold text-ink-2">Demo.</span> Sample data<span className="hidden sm:inline"> in your browser</span>
          <span className="hidden md:inline">: new runs replay recorded answers</span>. Nothing is saved.
        </p>
        <a href={REPO_URL} className="shrink-0 font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          Source on GitHub
        </a>
      </div>
    </aside>
  );
}

export function App() {
  const meta = useMeta();
  const qc = useQueryClient();
  useEffect(() => {
    const onAuth = () => qc.invalidateQueries({ queryKey: ['meta'] });
    window.addEventListener('evalbench:auth', onAuth);
    return () => window.removeEventListener('evalbench:auth', onAuth);
  }, [qc]);

  if (meta.isLoading) return <Loading label="Starting" />;
  const m = meta.data;
  // Each step gets its own form (the key), so one step's state and field values never leak into the next.
  if (m?.auth && !m.authenticated) {
    const mode = m.setup_required ? 'setup' : 'login';
    return <SignIn key={mode} mode={mode} legacy={m.username_required} usernameFromEnv={m.username_from_env} onDone={() => qc.invalidateQueries()} />;
  }
  if (m?.auth && m.username_required) return <SignIn key="username" mode="username" onDone={() => qc.invalidateQueries()} />;

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[1240px] px-5 pt-10 pb-24 md:px-10 md:pt-14">
        <Switch>
          <Route path="/">{() => <Verdict />}</Route>
          <Route path="/verdict/:suite">{(p) => <Verdict suite={p.suite} />}</Route>
          <Route path="/suites" component={Suites} />
          <Route path="/suites/:id">{(p) => <SuiteDetail id={p.id} />}</Route>
          <Route path="/models" component={Models} />
          <Route path="/runs" component={Runs} />
          <Route path="/runs/:id">{(p) => <RunDetailPage id={Number(p.id)} />}</Route>
          <Route path="/runs/:id/tasks/:task">{(p) => <Compare runId={Number(p.id)} taskId={p.task} />}</Route>
          <Route path="/rate" component={Rate} />
          {/* The scoreboard became the verdict: old links still land on the right job. */}
          <Route path="/scoreboard">{() => <Redirect to="/" replace />}</Route>
          <Route path="/scoreboard/:suite">{(p) => <Redirect to={`/verdict/${p.suite}`} replace />}</Route>
          <Route path="/data" component={DataPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route>
            <NotFound what="page" href="/" back="Back to the verdict" />
          </Route>
        </Switch>
      </main>
      {DEMO && <DemoNotice />}
    </div>
  );
}
