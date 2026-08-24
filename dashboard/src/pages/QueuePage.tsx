import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, QueueItem, subscribeToQueue } from '../lib/api';

export function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .getTodayCheckIns()
      .then((res) => {
        if (!cancelled) setItems(res.checkIns);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubscribe = subscribeToQueue((item) => {
      setItems((prev) => [item, ...prev.filter((existing) => existing.checkInId !== item.checkInId)]);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Today&apos;s arrivals</h1>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No check-ins yet today.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => (
            <li key={item.checkInId}>
              <Link
                to={`/patients/${item.patientId}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{item.patientName}</p>
                  <p className="text-sm text-slate-500">{new Date(item.paidAt).toLocaleTimeString()}</p>
                </div>
                <span className="text-sm text-slate-500">KES {item.amountKes}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
