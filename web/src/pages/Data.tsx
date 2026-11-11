import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api, download, type Model, type RatingRow } from '../api';
import { cx, ModelDot, PageHeader } from '../components/ui';
import { ago, thousands } from '../lib/format';

interface ExportSummary {
  ratings: number;
  pairs: number;
  results: number;
  suites: { id: string; title: string }[];
}

interface Export {
  title: string;
  text: string;
  count?: number;
  unit: string;
  /** The export's path under the API. */
  file: string;
  sample: string;
}

/** One export: what it holds, what a record looks like, how many there are. */
function ExportRow({ e, first, q }: { e: Export; first: boolean; q: string }) {
  return (
    <div
      className={cx('grid items-start gap-x-10 gap-y-4 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_170px]', !first && 'border-t border-line')}
    >
      <div className="min-w-0">
        <h2 className="text-[18px] leading-[1.2] font-bold tracking-[-0.015em]">{e.title}</h2>
        <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-muted">{e.text}</p>
      </div>
      <pre className="min-w-0 overflow-hidden border-l-2 border-line-2 pl-4 font-mono text-[12px] leading-[1.7] break-all whitespace-pre-wrap text-muted">
        {e.sample}
      </pre>
      <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-end lg:gap-3">
        <span className="text-[13.5px] text-muted">
          <span className="slab mr-0.5 text-[24px] leading-none font-semibold text-ink">{thousands(e.count)}</span> {e.unit}
        </span>
        <a className="btn-ghost h-9" {...download(`${e.file}${q}`)}>
          <Download size={14} /> Download
        </a>
      </div>
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

  const exports: Export[] = [
    {
      title: 'Ratings, CSV',
      text: 'One row per rating: prompt, both answers, models, 7-point preference, rubric scores, flags, justification and time spent.',
      count: s.data?.ratings,
      unit: 'rows',
      file: '/export/ratings.csv',
      sample: 'rating_id,rater,task_id,winner,\n  strength,a_correctness,...',
    },
    {
      title: 'Ratings, JSONL',
      text: 'The same records with nested scores and flags, one JSON object per line.',
      count: s.data?.ratings,
      unit: 'lines',
      file: '/export/ratings.jsonl',
      sample: '{"preference": -2, "winner": "a",\n "scores": {"a": {...}}, ...}',
    },
    {
      title: 'Preference pairs',
      text: 'Chosen and rejected answers from every decisive rating, ready for DPO-style training. Ties are left out.',
      count: s.data?.pairs,
      unit: 'pairs',
      file: '/export/preferences.jsonl',
      sample: '{"prompt": "...", "chosen": "...",\n "rejected": "...", "meta": {...}}',
    },
    {
      title: 'Run results',
      text: 'Every answer with its check results, score, latency and token counts.',
      count: s.data?.results,
      unit: 'answers',
      file: '/export/results.jsonl',
      sample: '{"model": "...", "passed": true,\n "checks": [...], "latency_ms": 812}',
    },
  ];

  return (
    <>
      <PageHeader
        title="Data"
        subtitle="Everything judges and checks produce, in formats you can analyse or train on. Each record carries the prompt and both answers."
        actions={
          <select aria-label="Suite" className="input h-9 w-auto py-0" value={suite} onChange={(e) => setSuite(e.target.value)}>
            <option value="">All suites</option>
            {s.data?.suites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        }
      />
      <div className="border-t-2 border-ink">
        {exports.map((e, i) => (
          <ExportRow key={e.file} e={e} first={i === 0} q={q} />
        ))}
      </div>

      <section className="mt-16 border-t-2 border-ink pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[19px] leading-[1.25] font-bold tracking-[-0.015em]">Latest ratings</h2>
          <span className="text-[13.5px] text-muted">The twenty most recent verdicts, newest first.</span>
        </div>
        <div className="mt-5">
          {ratings.data?.length === 0 && <div className="border-t border-line py-10 text-[14px] text-muted">No ratings yet.</div>}
          {ratings.data?.map((r) => {
            const a = byId.get(r.model_a);
            const b = byId.get(r.model_b);
            const winner = r.preference < 0 ? a : r.preference > 0 ? b : null;
            return (
              <div key={r.id} className="grid gap-x-8 gap-y-1.5 border-t border-line py-4 md:grid-cols-[240px_minmax(0,1fr)_120px]">
                <div className="min-w-0 text-[13.5px]">
                  <div className="flex items-center gap-1.5">
                    {a && <ModelDot color={a.color} size={7} />}
                    <span className={cx('truncate', r.preference < 0 ? 'font-semibold text-ink' : 'text-muted')}>{a?.label ?? r.model_a}</span>
                    <span className="text-faint">vs</span>
                    {b && <ModelDot color={b.color} size={7} />}
                    <span className={cx('truncate', r.preference > 0 ? 'font-semibold text-ink' : 'text-muted')}>{b?.label ?? r.model_b}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11.5px] text-faint">{r.task_id}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink-2">
                    {winner ? `${winner.label} preferred` : 'About the same'}
                    {winner && <span className="font-normal text-muted"> · {r.preference_label.replace(/^[AB] is /, '')}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 max-w-[80ch] text-[13.5px] leading-relaxed text-muted">{r.justification}</p>
                </div>
                <div className="flex gap-2 text-[12.5px] text-muted md:block md:text-right">
                  <div className="text-ink-2">{r.rater || 'anonymous'}</div>
                  <div>{ago(r.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
