import { useQuery } from '@tanstack/react-query';
import { Braces, Download, FileSpreadsheet, GitCompareArrows, ListChecks } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api, type Model, type RatingRow } from '../api';
import { Card, cx, ModelDot, PageHeader } from '../components/ui';
import { ago, thousands } from '../lib/format';

interface ExportSummary {
  ratings: number;
  pairs: number;
  results: number;
  suites: { id: string; title: string }[];
}

function ExportCard({
  icon,
  title,
  text,
  count,
  href,
  sample,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  count: string;
  href: string;
  sample: string;
}) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[11px] border border-line-2 bg-ink/[0.03] text-accent">{icon}</div>
        <span className="num text-[12px] text-muted">{count}</span>
      </div>
      <div className="mt-4 text-[14.5px] font-semibold">{title}</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{text}</p>
      <pre className="mt-3 overflow-hidden whitespace-pre-wrap break-all rounded-[9px] border border-line bg-panel-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-faint">
        {sample}
      </pre>
      <a className="btn-ghost mt-4" href={href}>
        <Download size={14} /> Download
      </a>
    </div>
  );
}

export function DataPage() {
  const [suite, setSuite] = useState('');
  const s = useQuery({ queryKey: ['export-summary'], queryFn: () => api.get<ExportSummary>('/export/summary') });
  const ratings = useQuery({
    queryKey: ['ratings', suite],
    queryFn: () => api.get<RatingRow[]>(`/ratings?limit=20${suite ? `&suite=${suite}` : ''}`),
  });
  const models = useQuery({ queryKey: ['models-all'], queryFn: () => api.get<Model[]>('/models?archived=true') });
  const byId = new Map(models.data?.map((m) => [m.id, m]));
  const q = suite ? `?suite=${suite}` : '';

  return (
    <>
      <PageHeader
        title="Data"
        subtitle="Everything raters and checks produce, in formats you can analyse or train on. Each record carries the prompt and both answers."
        actions={
          <select className="input h-9 w-auto py-0" value={suite} onChange={(e) => setSuite(e.target.value)}>
            <option value="">All suites</option>
            {s.data?.suites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ExportCard
          icon={<FileSpreadsheet size={18} />}
          title="Ratings, CSV"
          text="One row per rating: prompt, both answers, models, 7-point preference, rubric scores, flags, justification and time spent."
          count={`${thousands(s.data?.ratings)} rows`}
          href={`/api/export/ratings.csv${q}`}
          sample={'rating_id,rater,task_id,winner,\n  strength,a_correctness,...'}
        />
        <ExportCard
          icon={<Braces size={18} />}
          title="Ratings, JSONL"
          text="The same records with nested scores and flags, one JSON object per line."
          count={`${thousands(s.data?.ratings)} lines`}
          href={`/api/export/ratings.jsonl${q}`}
          sample={'{"preference": -2, "winner": "a",\n "scores": {"a": {...}}, ...}'}
        />
        <ExportCard
          icon={<GitCompareArrows size={18} />}
          title="Preference pairs"
          text="Chosen and rejected answers from every decisive rating, ready for DPO-style training. Ties are left out."
          count={`${thousands(s.data?.pairs)} pairs`}
          href={`/api/export/preferences.jsonl${q}`}
          sample={'{"prompt": "...", "chosen": "...",\n "rejected": "...", "meta": {...}}'}
        />
        <ExportCard
          icon={<ListChecks size={18} />}
          title="Run results"
          text="Every answer with its check results, score, latency and token counts."
          count={`${thousands(s.data?.results)} answers`}
          href={`/api/export/results.jsonl${q}`}
          sample={'{"model": "...", "passed": true,\n "checks": [...], "latency_ms": 812}'}
        />
      </div>

      <Card className="mt-5" title="Latest ratings" pad={false}>
        <div className="divide-y divide-line">
          {ratings.data?.length === 0 && <div className="px-5 py-10 text-center text-[13px] text-muted">No ratings yet.</div>}
          {ratings.data?.map((r) => {
            const a = byId.get(r.model_a);
            const b = byId.get(r.model_b);
            const winner = r.preference < 0 ? a : r.preference > 0 ? b : null;
            return (
              <div key={r.id} className="grid gap-x-5 gap-y-1 px-5 py-3.5 md:grid-cols-[220px_minmax(0,1fr)_120px]">
                <div className="min-w-0 text-[12.5px]">
                  <div className="flex items-center gap-1.5">
                    {a && <ModelDot color={a.color} size={6} />}
                    <span className={cx('truncate', r.preference < 0 ? 'font-semibold text-ink' : 'text-muted')}>{a?.label ?? r.model_a}</span>
                    <span className="text-faint">vs</span>
                    {b && <ModelDot color={b.color} size={6} />}
                    <span className={cx('truncate', r.preference > 0 ? 'font-semibold text-ink' : 'text-muted')}>{b?.label ?? r.model_b}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-faint">{r.task_id}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-ink-2">
                    {winner ? `${winner.label} preferred` : 'About the same'}{' '}
                    <span className="font-normal text-faint">· {r.preference_label.replace(/^[AB] is /, '')}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{r.justification}</p>
                </div>
                <div className="text-right text-[12px] text-faint">
                  <div className="text-ink-2">{r.rater || 'anonymous'}</div>
                  <div>{ago(r.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
