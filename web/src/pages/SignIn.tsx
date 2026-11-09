import { KeyRound, UserRound } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { ThemeMenu } from '../components/ThemeMenu';
import { ErrorNote } from '../components/ui';

export type SignInMode = 'setup' | 'login' | 'username';

const MIN_PASSWORD = 8;

/*
  One owner account: a username and a password, so a password manager saves and fills the whole login.
  The inputs are uncontrolled and read at submit time. Password managers (Bitwarden among them) fill
  values without firing key events, so nothing here waits for typing: the button is never disabled
  except while a request is in flight, and every check runs on the values the form holds at submit.
*/
export function SignIn({
  mode,
  legacy = false,
  usernameFromEnv = false,
  onDone,
}: {
  mode: SignInMode;
  /** An install from before usernames: sign in with the password alone, then pick a username. */
  legacy?: boolean;
  usernameFromEnv?: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const askUsername = mode !== 'login' || !legacy;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const again = String(data.get('password-again') ?? '');
    const problem =
      askUsername && !username
        ? mode === 'login'
          ? 'Enter your username.'
          : 'Choose a username.'
        : !password
          ? mode === 'username'
            ? 'Enter your current password.'
            : mode === 'setup'
              ? 'Choose a password.'
              : 'Enter your password.'
          : mode === 'setup' && password.length < MIN_PASSWORD
            ? `Use at least ${MIN_PASSWORD} characters for the password.`
            : mode === 'setup' && again !== password
              ? 'The two passwords differ.'
              : null;
    if (problem) {
      setError(new Error(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'setup' ? '/auth/setup' : mode === 'username' ? '/auth/username' : '/auth/login';
      await api.post(path, { username, password });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode === 'login' && legacy ? 'legacy' : mode];
  return (
    <div className="relative grid min-h-full place-items-center overflow-x-clip px-5 py-12">
      <div className="absolute top-4 right-4 sm:top-5 sm:right-6">
        <ThemeMenu />
      </div>
      <div className="relative w-full max-w-[430px] animate-rise">
        {/* The face-down card underneath: the same pair as the mark. */}
        <div aria-hidden className="absolute inset-0 -rotate-[4deg] rounded-[18px] bg-azure shadow-[0_24px_50px_-30px_rgb(var(--shade)/0.55)]" />
        <form method="post" noValidate onSubmit={submit} className="card relative p-7 sm:p-9" aria-labelledby="sign-in-title">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-[16px] font-bold tracking-[-0.02em]">Evalbench</span>
          </div>
          <h1 id="sign-in-title" className="mt-7 text-[30px] leading-[1.1] font-bold tracking-[-0.03em] text-balance">
            {copy.title}
          </h1>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{copy.body}</p>

          <div className="mt-7 grid gap-4">
            {askUsername && (
              <Field
                id="username"
                label="Username"
                icon={<UserRound size={14} />}
                hint={mode === 'setup' && usernameFromEnv ? 'Use the username set in EVALBENCH_USERNAME.' : undefined}
              >
                <input
                  id="username"
                  name="username"
                  className="input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={64}
                  autoFocus
                />
              </Field>
            )}
            <Field
              id="password"
              label={mode === 'username' ? 'Current password' : 'Password'}
              icon={<KeyRound size={14} />}
              hint={mode === 'setup' ? `At least ${MIN_PASSWORD} characters.` : undefined}
            >
              <input
                id="password"
                name="password"
                className="input"
                type="password"
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                autoFocus={!askUsername}
              />
            </Field>
            {mode === 'setup' && (
              <Field id="password-again" label="Password, once more">
                <input id="password-again" name="password-again" className="input" type="password" autoComplete="new-password" />
              </Field>
            )}
          </div>

          <div className="mt-5 empty:hidden" role="alert">
            {error ? <ErrorNote error={error} /> : null}
          </div>
          <button type="submit" className="btn-primary mt-5 h-11 w-full" disabled={busy}>
            {busy ? copy.busy : copy.action}
          </button>
          {copy.foot && <p className="mt-5 text-center text-[12.5px] leading-relaxed text-faint">{copy.foot}</p>}
        </form>
      </div>
    </div>
  );
}

function Field({ id, label, icon, hint, children }: { id: string; label: string; icon?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-2">
        {icon}
        {label}
      </label>
      {children}
      {hint && <div className="mt-1.5 text-[12.5px] text-muted">{hint}</div>}
    </div>
  );
}

const COPY: Record<SignInMode | 'legacy', { title: string; body: string; action: string; busy: string; foot?: string }> = {
  setup: {
    title: 'Make the owner account',
    body: 'Evalbench can spend your API credits and run model-written code, so one account holds the keys. You make it once, here.',
    action: 'Create account and continue',
    busy: 'Creating',
    foot: 'Your password manager can save this login. To skip this page, set EVALBENCH_USERNAME and EVALBENCH_PASSWORD.',
  },
  login: {
    title: 'Welcome back',
    body: 'Sign in to judge, run and read the scores.',
    action: 'Sign in',
    busy: 'Signing in',
  },
  legacy: {
    title: 'Welcome back',
    body: 'Sign in with your password. Next, you pick a username, so your password manager can save the whole login.',
    action: 'Sign in',
    busy: 'Signing in',
  },
  username: {
    title: 'Pick a username',
    body: 'Evalbench now signs in with a username and a password, so your password manager can save the whole login. Your password stays the same: enter it once more to confirm.',
    action: 'Save and continue',
    busy: 'Saving',
  },
};
