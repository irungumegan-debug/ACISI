import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock, FlaskConical } from 'lucide-react';
import { api, ApiError, LabQueueItem, subscribeToQueue } from '../lib/api';
import { Avatar, EmptyState, PageHeader, SkeletonList, StatusBadge } from '../components/ui';

const SEX_LABEL: Record<string, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };

function describePatient(item: Pick<LabQueueItem, 'age' | 'sex'>): string {
  return [item.age !== null ? `${item.age} yrs` : null, SEX_LABEL[item.sex] ?? null].filter(Boolean).join(' · ');
}

function waited(since: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/** The clinic's lab queue: open lab requests, oldest first. Live: new requests appear as doctors send them. */
export function LabQueuePage() {
  const [items, setItems] = useState<LabQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getLabQueue()
        .then((r) => {
          if (!cancelled) setItems(r.queue);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the lab queue.');
        });
    void load();
    const unsubscribe = subscribeToQueue(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <div>
      <PageHeader title="Lab queue" subtitle="Tests the doctors have requested. Open one to enter the results." />
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {items === null && !error && <SkeletonList rows={3} label="Loading the lab queue" />}
      {items && items.length === 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card">
          <EmptyState icon={FlaskConical} title="No lab requests right now." />
        </div>
      )}
      {items && items.length > 0 && (
        <ol className="space-y-3">
          {items.map((item) => (
            <li key={item.labOrderId}>
              <Link
                to={`/lab/orders/${item.labOrderId}`}
                className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-blue-500 hover:shadow-raised"
              >
                <Avatar name={item.patientName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-semibold text-navy-900">{item.patientName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-500">
                    <span>{item.patientCode}</span>
                    {describePatient(item) && <span>{describePatient(item)}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={13} aria-hidden /> {waited(item.requestedAt, now)} ago · {item.requestedByName}
                    </span>
                  </p>
                  <p className="mt-1.5 text-sm text-ink-700">{item.testNames.join(', ')}</p>
                </div>
                <StatusBadge status={item.status} />
                <ChevronRight size={18} aria-hidden className="flex-none text-ink-400" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
