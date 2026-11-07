import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Boxes, Database, FileStack, Gauge, LayoutGrid, Lock, Play, Scale, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
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

export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6cb6ff" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <rect x="7.5" y="16" width="4" height="9" rx="2" fill="#fff" fillOpacity=".55" />
      <rect x="14" y="11" width="4" height="14" rx="2" fill="#fff" fillOpacity=".8" />
      <rect x="20.5" y="6.5" width="4" height="18.5" rx="2" fill="#fff" />
    </svg>
  );
}

function NavItem({
  href,
  icon,
  children,
  badge,
  match,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  match?: (path: string) => boolean;
}) {
  const [location] = useLocation();
  const active = match ? match(location) : location === href || location.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cx(
        'group relative flex items-center gap-3 rounded-[9px] px-3 h-9 text-[13.5px] transition-colors',
        active ? 'bg-white/[0.07] text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.035]',
      )}
    >
      {active && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
      <span className={cx('transition-colors', active ? 'text-accent' : 'text-faint group-hover:text-ink-2')}>{icon}</span>
      <span className="flex-1">{children}</span>
      {badge}
    </Link>
  );
}

function Sidebar() {
  const meta = useMeta();
  const [rater] = useRater();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewData>('/overview'), refetchInterval: 15_000 });
  const toRate = overview.data?.rating.reduce((n, r) => n + r.remaining, 0) ?? 0;
  return (
    <aside className="hidden md:flex w-[244px] shrink-0 flex-col border-r border-line bg-rail px-3 py-4">
      <Link href="/" className="flex items-center gap-2.5 px-2.5 pb-5 pt-1">
        <Logo />
        <span className="text-[15.5px] font-semibold tracking-[-0.01em]">Evalbench</span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        <NavItem href="/" icon={<LayoutGrid size={16} />} match={(p) => p === '/'}>
          Overview
        </NavItem>
        <NavItem href="/suites" icon={<FileStack size={16} />}>
          Suites
        </NavItem>
        <NavItem href="/models" icon={<Boxes size={16} />}>
          Models
        </NavItem>
        <NavItem href="/runs" icon={<Play size={16} />}>
          Runs
        </NavItem>
        <NavItem
          href="/rate"
          icon={<Scale size={16} />}
          badge={toRate > 0 ? <span className="num rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">{toRate}</span> : null}
        >
          Rate blind
        </NavItem>
        <NavItem href="/scoreboard" icon={<BarChart3 size={16} />}>
          Scoreboard
        </NavItem>
        <NavItem href="/data" icon={<Database size={16} />}>
          Data
        </NavItem>
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        {meta.data?.demo && (
          <div className="mx-1 mb-3 rounded-[10px] border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-[12px] leading-snug text-ink-2">
            <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-accent">
              <Gauge size={13} /> Demo workspace
            </div>
            Fictional models with scripted answers, graded for real.
          </div>
        )}
        <NavItem href="/settings" icon={<SettingsIcon size={16} />}>
          Settings
        </NavItem>
        <div className="flex items-center justify-between px-3 pt-3 text-[11.5px] text-faint">
          <span>{rater ? `Rating as ${rater}` : 'No rater name yet'}</span>
          <span className="num">v{meta.data?.version ?? ''}</span>
        </div>
      </div>
    </aside>
  );
}

function MobileBar() {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-rail/95 px-4 h-12 backdrop-blur">
      <Logo size={22} />
      <span className="font-semibold">Evalbench</span>
      <nav className="ml-auto flex gap-3 text-[12.5px] text-muted">
        <Link href="/runs">Runs</Link>
        <Link href="/rate">Rate</Link>
        <Link href="/scoreboard">Scores</Link>
      </nav>
    </div>
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
    <div className="grid min-h-full place-items-center bg-grid p-6">
      <form onSubmit={submit} className="card w-full max-w-[380px] p-7 animate-rise">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <span className="text-[16px] font-semibold">Evalbench</span>
        </div>
        {setup && (
          <div className="mb-5">
            <div className="text-[15px] font-semibold">Create a password</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Evalbench can spend your API credits and run model-written code, so it asks for a password. You set it once, here.
            </p>
          </div>
        )}
        <label className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
          <Lock size={13} /> Password
        </label>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete={setup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {setup && (
          <>
            <label className="mb-1.5 mt-3 block text-[12.5px] font-medium text-ink-2">Again</label>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <div className={`mt-2 text-[12px] ${mismatch ? 'text-bad-ink' : 'text-faint'}`}>
              {mismatch ? 'The two passwords differ.' : 'At least 8 characters.'}
            </div>
          </>
        )}
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
        <button className="btn-primary mt-4 w-full" disabled={busy || !ready}>
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
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar />
        <main className="relative flex-1 overflow-y-auto">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[340px] bg-[radial-gradient(900px_300px_at_20%_-10%,#4da3ff14,transparent_70%)]" />
          <div className="relative mx-auto max-w-[1280px] px-5 py-8 md:px-9 md:py-9">
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
                  <Link href="/" className="text-accent">
                    Back to the overview
                  </Link>
                </div>
              </Route>
            </Switch>
          </div>
        </main>
      </div>
    </div>
  );
}
