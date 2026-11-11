import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, LogOut, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../api';
import { THEME_OPTIONS } from '../components/ThemeMenu';
import { ErrorNote, Field, Loading, PageHeader, Section, Segmented } from '../components/ui';
import { DEMO } from '../lib/demo';
import { useMeta, useRater } from '../lib/hooks';
import { useTheme } from '../lib/theme';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 border-t border-line py-3 text-[14px] first:border-t-0 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-ink-2">{children}</span>
    </div>
  );
}

/** A setting that is either in order or needs a look: the mark carries the state, the words stay ink. */
function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-start gap-1.5 ${ok ? '' : 'font-semibold text-warn'}`}>
      {ok ? (
        <Check size={15} strokeWidth={2.4} className="mt-[3px] shrink-0 text-good" />
      ) : (
        <X size={15} strokeWidth={2.4} className="mt-[3px] shrink-0" />
      )}
      <span>{children}</span>
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
      <Section first title="System" note="Read from the environment when the server starts.">
        <Row label="Version">
          <span className="num">{m.version}</span>
        </Row>
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
          <span className="font-mono text-[12.5px] break-all">{m.data_dir}</span>
        </Row>
        <Row label="Parallel requests">{m.concurrency} across all models</Row>
        <Row label="Justification minimum">{m.min_justification} characters</Row>
        <Row label="Sign-in">
          {m.auth ? (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <Ok ok>
                {m.username ? <>as {m.username}</> : 'on'}
                {m.username_from_env || m.password_from_env ? ', from the environment' : ''}
              </Ok>
              <button className="btn-quiet h-7 text-[12.5px]" onClick={() => logout.mutate()}>
                <LogOut size={13} /> Sign out
              </button>
            </span>
          ) : DEMO ? (
            'not needed: the demo has no accounts'
          ) : (
            <span className="font-semibold text-warn">off: only localhost can connect</span>
          )}
        </Row>
      </Section>

      <Section
        title="API keys"
        note="Keys are read from the environment when a request is made. They are never written to the database, logs or exports."
      >
        {Object.entries(m.keys ?? {}).map(([provider, k]) => (
          <Row key={provider} label={provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}>
            {DEMO && !k.present ? (
              'not needed here: the demo replays recorded answers'
            ) : (
              <Ok ok={k.present}>
                <span className="font-mono text-[12.5px]">{k.env}</span> {k.present ? 'is set' : 'is not set'}
              </Ok>
            )}
          </Row>
        ))}
      </Section>

      <Section
        title="Appearance"
        note={`${pref === 'system' ? `Following this device, which asks for ${theme}.` : `Always ${theme}.`} Saved in this browser.`}
      >
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
      </Section>

      <Section title="Judge" note="Saved in this browser. Your verdicts are signed with it, and each judge gets a queue of their own.">
        <Field label="Your name or initials" className="max-w-[460px]">
          <div className="flex gap-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sam" />
            <button className="btn-ghost shrink-0" disabled={name.trim() === rater} onClick={() => setRater(name)}>
              Save
            </button>
          </div>
        </Field>
      </Section>

      <Section title="Demo workspace" note="A full workspace to look around in before you connect a model of your own.">
        <p className="max-w-[66ch] text-[14.5px] leading-relaxed text-ink-2">
          Adds two sample jobs, support triage and the core battery, with nine runs across five fictional models and the blind ratings of two judges.
          The answers are scripted; every score is computed by the real engine. It adds to your data and does not touch anything else.
        </p>
        <button className="btn-ghost mt-5" disabled={m.demo || demo.isPending} onClick={() => demo.mutate()}>
          {m.demo ? 'Demo loaded' : demo.isPending ? 'Loading' : 'Load the demo'}
        </button>
        <div className="mt-3">
          <ErrorNote error={demo.error} />
        </div>
      </Section>
    </>
  );
}
