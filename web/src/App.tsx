import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { api, type Overview as OverviewData } from './api';
import { cx, ErrorNote, Loading } from './components/ui';
import { useMeta, useRater } from './lib/hooks';
import { Compare } from './pages/Compare';
import { DataPage } from './pages/Data';
import { Models } from './pages/Models';
import { Overview } from './pages/Overview';
import { Rate } from './pages/Rate';
import { RunDetailPage } from './pages/RunDetail';
import { Runs } from './pages/Runs';
import { Scoreboard } from './pages/Scoreboard';
import { SettingsPage } from './pages/Settings';
import { SuiteDetail } from './pages/SuiteDetail';
import { Suites } from './pages/Suites';

/** Two tasting cards: one still face down, one turned over and ticked by the judge. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#17181c" />
      <g transform="rotate(-11 11.5 17)">
        <rect x="5.5" y="9" width="12" height="16.5" rx="2.4" fill="#2457f0" />
      </g>
      <g transform="rotate(8 20.5 15.5)">
        <rect x="14.5" y="7.25" width="12" height="16.5" rx="2.4" fill="#fffdf8" />
        <path d="M17.4 15.6l2.5 2.6 4.4-5.3" fill="none" stroke="#d23c2a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const NAV: { href: string; label: string; exact?: boolean }[] = [
  { href: '/', label: 'Overview', exact: true },
  { href: '/rate', label: 'Judge' },
  { href: '/scoreboard', label: 'Scoreboard' },
  { href: '/runs', label: 'Runs' },
  { href: '/suites', label: 'Suites' },
  { href: '/models', label: 'Models' },
  { href: '/data', label: 'Data' },
];

function NavLink({ href, label, exact, badge }: { href: string; label: string; exact?: boolean; badge?: ReactNode }) {
  const [location] = useLocation();
  const active = exact ? location === href : location === href || location.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-16 shrink-0 items-center gap-1.5 text-[14.5px] font-semibold transition-colors',
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
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1240px] items-center gap-8 px-5 md:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[17px] font-bold tracking-[-0.02em]">Evalbench</span>
        </Link>
        <nav aria-label="Main" className="-mb-px flex min-w-0 flex-1 gap-6 overflow-x-auto [scrollbar-width:none]">
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
        <div className="flex shrink-0 items-center gap-4">
          {meta.data?.demo && (
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
          <Link href="/settings" className="btn-quiet h-9 w-9 p-0" aria-label="Settings" title="Settings">
            <SettingsIcon size={17} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Login({ onDone, setup }: { onDone: () => void; setup: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = setup && confirm.length > 0 && confirm !== password;
  const ready = setup ? password.length >= 8 && confirm === password : password.length > 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(setup ? '/auth/setup' : '/auth/login', { password });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-full place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-[420px] p-8 animate-rise">
        <Logo size={40} />
        <h1 className="mt-6 text-[30px] leading-tight font-bold tracking-[-0.03em]">{setup ? 'Set the house password' : 'Welcome back'}</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
          {setup
            ? 'Evalbench can spend your API credits and run model-written code, so it asks for a password. You set it once, here.'
            : 'Sign in to judge, run and read the scores.'}
        </p>
        <label htmlFor="password" className="mt-7 mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-2">
          <Lock size={14} /> Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          autoFocus
          autoComplete={setup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {setup && (
          <>
            <label htmlFor="password-again" className="mt-4 mb-1.5 block text-[13.5px] font-semibold text-ink-2">
              Once more
            </label>
            <input
              id="password-again"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className={`mt-2 text-[12.5px] ${mismatch ? 'text-bad-ink' : 'text-muted'}`}>
              {mismatch ? 'The two passwords differ.' : 'At least 8 characters.'}
            </div>
          </>
        )}
        <div className="mt-4">
          <ErrorNote error={error} />
        </div>
        <button className="btn-primary mt-5 w-full" disabled={busy || !ready}>
          {setup ? 'Set password and continue' : 'Sign in'}
        </button>
      </form>
    </div>
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
  if (meta.data?.auth && !meta.data.authenticated) return <Login setup={!!meta.data.setup_required} onDone={() => qc.invalidateQueries()} />;

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[1240px] px-5 pt-10 pb-24 md:px-10 md:pt-14">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/suites" component={Suites} />
          <Route path="/suites/:id">{(p) => <SuiteDetail id={p.id} />}</Route>
          <Route path="/models" component={Models} />
          <Route path="/runs" component={Runs} />
          <Route path="/runs/:id">{(p) => <RunDetailPage id={Number(p.id)} />}</Route>
          <Route path="/runs/:id/tasks/:task">{(p) => <Compare runId={Number(p.id)} taskId={p.task} />}</Route>
          <Route path="/rate" component={Rate} />
          <Route path="/scoreboard">{() => <Scoreboard />}</Route>
          <Route path="/scoreboard/:suite">{(p) => <Scoreboard suite={p.suite} />}</Route>
          <Route path="/data" component={DataPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route>
            <div className="py-24 text-center text-muted">
              Nothing here.{' '}
              <Link href="/" className="link">
                Back to the overview
              </Link>
            </div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}
