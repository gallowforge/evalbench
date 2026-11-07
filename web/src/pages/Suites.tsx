import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileStack, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, type SuitePayload, type SuiteSummary } from '../api';
import { YamlEditor } from '../components/LazyYaml';
import { Empty, ErrorNote, Loading, Modal, PageHeader } from '../components/ui';
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
        subtitle="A suite is a set of tasks with automatic checks and a rubric for human raters. Edit them here or keep them as YAML in git."
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
        <div className="card">
          <Empty icon={<FileStack size={18} />} title="No suites">
            Create one or import a YAML file.
          </Empty>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((s) => (
          <Link key={s.id} href={`/suites/${s.id}`} className="card group flex flex-col p-5 transition-colors hover:border-line-2 hover:bg-panel-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{s.title}</div>
                <div className="mt-0.5 font-mono text-[11.5px] text-faint">
                  {s.id} · v{s.version}
                </div>
              </div>
              <span className="num shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-ink-2">{plural(s.tasks, 'task')}</span>
            </div>
            <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-muted">{s.description || 'No description.'}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(s.categories).map(([c, n]) => (
                <span key={c} className="chip capitalize">
                  {c} <span className="num text-faint">{n}</span>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(s.check_types).map(([c, n]) => (
                <span key={c} className="chip border-transparent bg-white/[0.025] font-mono text-[11px] text-faint">
                  {CHECK_LABEL[c] ?? c} ×{n}
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-3.5 text-[12px] text-faint" style={{ marginTop: 18 }}>
              <span>{s.runs ? `${plural(s.runs, 'run')} · last ${ago(s.last_run?.created_at)}` : 'Never run'}</span>
              <span>edited {ago(s.updated_at)}</span>
            </div>
          </Link>
        ))}
      </div>
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
            <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(text)}>
              Create suite
            </button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-muted">
          Paste or write YAML. See <span className="font-mono text-ink-2">examples/suite-template.yaml</span> for every field and check type.
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
