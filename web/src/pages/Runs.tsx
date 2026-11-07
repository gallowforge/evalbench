import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { api, type RunListItem } from '../api';
import { NewRunModal, RunRow } from '../components/runs';
import { Empty, ErrorNote, Loading, PageHeader } from '../components/ui';

export function Runs() {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.get<RunListItem[]>('/runs'),
    refetchInterval: (query) => (query.state.data?.some((r) => r.active) ? 1_500 : 10_000),
  });
  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Each run sends every task in a suite to every chosen model and grades the answers as they arrive."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Play size={15} /> New run
          </button>
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && q.data.length === 0 && (
        <div className="card">
          <Empty
            icon={<Play size={18} />}
            title="No runs yet"
            action={
              <button className="btn-primary" onClick={() => setOpen(true)}>
                Start the first run
              </button>
            }
          >
            Pick a suite and a few models. Answers are graded by the suite's checks as soon as they come back.
          </Empty>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="card p-1.5">
          {q.data.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}
      <NewRunModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
