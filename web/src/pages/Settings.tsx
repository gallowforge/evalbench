import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, LogOut, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../api';
import { THEME_OPTIONS } from '../components/ThemeMenu';
import { Card, ErrorNote, Field, Loading, PageHeader, Segmented } from '../components/ui';
import { DEMO } from '../lib/demo';
import { useMeta, useRater } from '../lib/hooks';
import { useTheme } from '../lib/theme';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-right text-[13px] text-ink-2">{children}</span>
    </div>
  );
}

function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${ok ? 'text-good-ink' : 'text-warn'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {children}
    </span>
  );
}

export function SettingsPage() {
  const meta = useMeta();
  const qc = useQueryClient();
  const [rater, setRater] = useRater();
  const { pref, theme, setPref } = useTheme();
  const [name, setName] = useState(rater);
  const demo = useMutation({ mutationFn: () => api.post('/demo'), onSuccess: () => qc.invalidateQueries() });
  const logout = useMutation({ mutationFn: () => api.post('/auth/logout'), onSuccess: () => qc.invalidateQueries() });
  if (meta.isLoading) return <Loading />;
  const m = meta.data!;
  return (
    <>
      <PageHeader title="Settings" subtitle="Evalbench is configured with environment variables; this page shows what it found." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="System">
          <Row label="Version">{m.version}</Row>
          <Row label="Code sandbox">
            <Ok ok={!!m.sandbox?.ok}>
              {DEMO
                ? 'not used here: the demo shows recorded check results'
                : m.sandbox?.mode === 'container'
                  ? 'separate container, no network'
                  : m.sandbox?.mode === 'local'
                    ? 'this machine, with limits (EVALBENCH_SANDBOX=local)'
                    : 'off: Python checks are recorded as errors'}
            </Ok>
          </Row>
          <Row label="Data directory">
            <span className="font-mono text-[12px]">{m.data_dir}</span>
          </Row>
          <Row label="Parallel requests">{m.concurrency} across all models</Row>
          <Row label="Justification minimum">{m.min_justification} characters</Row>
          <Row label="Sign-in">
            {m.auth ? (
              <span className="inline-flex items-center gap-3">
                <Ok ok>
                  {m.username ? <>as {m.username}</> : 'on'}
                  {m.username_from_env || m.password_from_env ? ', from the environment' : ''}
                </Ok>
                <button className="btn-quiet h-7 text-[12px]" onClick={() => logout.mutate()}>
                  <LogOut size={13} /> Sign out
                </button>
              </span>
            ) : DEMO ? (
              'not needed: the demo has no accounts'
            ) : (
              <span className="text-warn">off: only localhost can connect</span>
            )}
          </Row>
        </Card>
        <Card title="API keys">
          <p className="mb-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" /> Keys are read from the environment when a request is made. They are
            never written to the database, logs or exports.
          </p>
          {Object.entries(m.keys ?? {}).map(([provider, k]) => (
            <Row key={provider} label={provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}>
              <span className="inline-flex items-center gap-2 font-mono text-[12px]">
                <KeyRound size={13} className="text-faint" />
                {k.env} <Ok ok={k.present}>{k.present ? 'set' : 'not set'}</Ok>
              </span>
            </Row>
          ))}
        </Card>
        <Card title="Appearance">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[13px] leading-relaxed text-muted">
              {pref === 'system' ? `Following this device, which asks for ${theme}.` : `Always ${theme}.`} Saved in this browser.
            </p>
            <Segmented
              value={pref}
              onChange={setPref}
              options={THEME_OPTIONS.map((o) => ({
                value: o.value,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <o.icon size={14} /> {o.label}
                  </span>
                ),
              }))}
            />
          </div>
        </Card>
        <Card title="Rater">
          <Field label="Your name or initials" hint="Saved in this browser. Ratings are labelled with it and each rater gets their own queue.">
            <div className="flex gap-2">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sam" />
              <button className="btn-ghost" disabled={name.trim() === rater} onClick={() => setRater(name)}>
                Save
              </button>
            </div>
          </Field>
        </Card>
        <Card title="Demo workspace">
          <p className="text-[13px] leading-relaxed text-muted">
            Adds six weekly runs of the core battery against four fictional models, with blind ratings. The answers are scripted; every score is
            computed by the real engine. It adds to your data and does not touch anything else.
          </p>
          <button className="btn-ghost mt-4" disabled={m.demo || demo.isPending} onClick={() => demo.mutate()}>
            <Sparkles size={14} /> {m.demo ? 'Demo loaded' : demo.isPending ? 'Loading' : 'Load the demo'}
          </button>
          <div className="mt-3">
            <ErrorNote error={demo.error} />
          </div>
        </Card>
      </div>
    </>
  );
}
