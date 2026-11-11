import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileStack, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type SuitePayload, type SuiteSummary } from '../api';
import { YamlEditor } from '../components/LazyYaml';
import { cx, Empty, ErrorNote, Loading, Modal, PageHeader } from '../components/ui';
import { DEMO, SUITES_READ_ONLY } from '../lib/demo';
import { ago, plural } from '../lib/format';

const CHECK_LABEL: Record<string, string> = {
  exact: 'exact',
  contains: 'contains',
  not_contains: 'avoids',
  regex: 'regex',
  length: 'length',
  json: 'json',
  python: 'python tests',
};

const STARTER = `id: my-suite
title: My suite
description: What this suite is for.
tasks:
  - id: first-task
    title: First task
    category: reasoning
    prompt: |
      A train leaves at 09:40 and arrives at 13:05. How long is the journey?
      End with a final line in the form \`Answer: <h>h <m>m\`.
    checks:
      - type: regex
        extract: final_answer
        pattern: '3\\s*h\\s*25\\s*m'
`;

export function Suites() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(STARTER);
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['suites'], queryFn: () => api.get<SuiteSummary[]>('/suites') });
  const create = useMutation({
    mutationFn: (yaml: string) => api.post<SuitePayload>('/suites', { yaml }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['suites'] });
      setOpen(false);
      navigate(`/suites/${s.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Suites"
        subtitle="A suite is one job written down: its tasks, the checks that grade each answer and the rubric for human judges. Edit it here or keep it as YAML in git."
        actions={
          <>
            <input
              ref={file}
              type="file"
              accept=".yaml,.yml,text/yaml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setText(await f.text());
                  setOpen(true);
                }
                e.target.value = '';
              }}
            />
            <button className="btn-ghost" onClick={() => file.current?.click()}>
              <Upload size={14} /> Import YAML
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setText(STARTER);
                setOpen(true);
              }}
            >
              <FilePlus2 size={15} /> New suite
            </button>
          </>
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data?.length === 0 && (
        <div className="border-t-2 border-ink">
          <Empty icon={<FileStack size={18} />} title="No suites">
            Create one or import a YAML file.
          </Empty>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="border-t-2 border-ink">
          {q.data.map((s, i) => (
            <Link
              key={s.id}
              href={`/suites/${s.id}`}
              className={cx('group grid gap-x-12 gap-y-4 py-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_140px]', i > 0 && 'border-t border-line')}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[20px] leading-[1.2] font-bold tracking-[-0.02em] underline-offset-4 group-hover:underline">{s.title}</span>
                  <span className="font-mono text-[12px] text-faint">
                    {s.id} · v{s.version}
                  </span>
                </div>
                <p className="mt-2.5 line-clamp-3 max-w-[58ch] text-[14px] leading-relaxed text-muted">{s.description || 'No description.'}</p>
              </div>
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] content-start gap-x-3 gap-y-2 text-[13.5px]">
                <dt className="text-faint">{plural(s.tasks, 'task')}</dt>
                <dd className="text-ink-2">
                  {Object.entries(s.categories)
                    .map(([c, n]) => `${c} ${n}`)
                    .join(' · ')}
                </dd>
                <dt className="text-faint">Graded by</dt>
                <dd className="text-ink-2">
                  {Object.entries(s.check_types)
                    .map(([c, n]) => `${CHECK_LABEL[c] ?? c} ×${n}`)
                    .join(' · ') || 'human judges only'}
                </dd>
              </dl>
              <div className="text-[13px] leading-relaxed text-muted md:text-right">
                <div className="font-semibold text-ink-2">{s.runs ? plural(s.runs, 'run') : 'Never run'}</div>
                {s.runs > 0 && <div>latest {ago(s.last_run?.created_at)}</div>}
                <div className="text-faint">edited {ago(s.updated_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New suite"
        width={760}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={DEMO || create.isPending} onClick={() => create.mutate(text)}>
              Create suite
            </button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-muted">
          {DEMO ? `${SUITES_READ_ONLY} ` : 'Paste or write YAML. '}See <span className="font-mono text-ink-2">examples/suite-template.yaml</span> for
          every field and check type.
        </p>
        <YamlEditor value={text} onChange={setText} minHeight={380} />
        {create.error && (
          <div className="mt-3">
            <ErrorNote error={create.error} />
          </div>
        )}
      </Modal>
    </>
  );
}
