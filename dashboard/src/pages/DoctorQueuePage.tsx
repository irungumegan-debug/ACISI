import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DoctorPresenceStatus, DoctorQueueItem } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
};

export function DoctorQueuePage() {
  const [items, setItems] = useState<DoctorQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<DoctorPresenceStatus | null>(null);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [togglingPresence, setTogglingPresence] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getDoctorQueue()
      .then((res) => {
        if (!cancelled) {
          setItems(res.queue);
          setPresence(res.presence);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTogglePresence(): Promise<void> {
    const nextStatus = presence === 'IN' ? 'OUT' : 'IN';
    setTogglingPresence(true);
    setPresenceError(null);
    try {
      const result = await api.setOwnPresence(nextStatus);
      setPresence(result.presence);
    } catch (err) {
      setPresenceError(err instanceof ApiError ? err.message : 'Failed to update presence');
    } finally {
      setTogglingPresence(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Today&apos;s queue</h1>
      <p className="mb-4 text-sm text-slate-500">Only patients checked in to your department appear here.</p>

      {(presence === 'IN' || presence === 'OUT') && (
        <div
          className={`mb-4 flex items-center justify-between gap-3 rounded-lg border p-4 ${
            presence === 'IN' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div>
            <p className={`text-sm font-medium ${presence === 'IN' ? 'text-emerald-900' : 'text-amber-900'}`}>
              {presence === 'IN' ? "You're marked in today" : "You're marked out today"}
            </p>
            {presence === 'OUT' && (
              <p className="text-xs text-amber-800">You won&apos;t receive new patient assignments while marked out.</p>
            )}
            {presenceError && <p className="mt-1 text-xs text-red-600">{presenceError}</p>}
          </div>
          <button
            onClick={() => void handleTogglePresence()}
            disabled={togglingPresence}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
          >
            {togglingPresence ? 'Updating…' : presence === 'IN' ? 'Mark myself out for today' : 'Mark myself in for today'}
          </button>
        </div>
      )}

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
