import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DoctorQueueItem } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
};

export function DoctorQueuePage() {
  const [items, setItems] = useState<DoctorQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getDoctorQueue()
      .then((res) => {
        if (!cancelled) setItems(res.queue);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Today&apos;s queue</h1>
      <p className="mb-4 text-sm text-slate-500">Only patients checked in to your department appear here.</p>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No patients waiting right now.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => (
            <li key={item.encounterId}>
              <Link
                to={`/doctor/encounters/${item.encounterId}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{item.patientName}</p>
                  <p className="text-xs text-slate-500">{item.patientCode}</p>
                </div>
                <span className="whitespace-nowrap rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
