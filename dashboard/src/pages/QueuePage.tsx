import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, QueueItem, subscribeToQueue } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  FAILED: 'Payment failed',
  WAITING: 'Waiting',
  IN_CONSULTATION: 'With doctor',
  READY_FOR_CHECKOUT: 'Ready for checkout',
  DONE: 'Done',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING_PAYMENT: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  WAITING: 'bg-amber-100 text-amber-800',
  IN_CONSULTATION: 'bg-sky-100 text-sky-800',
  READY_FOR_CHECKOUT: 'bg-slate-200 text-slate-800',
  DONE: 'bg-slate-100 text-slate-500',
};

/** Payment isn't resolved (still pending, or failed and awaiting a manual rescue) — the encounter, if any, hasn't started yet. */
function isUnresolvedPayment(item: QueueItem): boolean {
  return item.checkInStatus === 'PENDING_PAYMENT' || item.checkInStatus === 'FAILED';
}

function displayStatus(item: QueueItem): string {
  return isUnresolvedPayment(item) ? item.checkInStatus : (item.encounterStatus ?? 'WAITING');
}

export function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return api.getTodayCheckIns().then((res) => setItems(res.checkIns));
  }, []);

  useEffect(() => {
    let cancelled = false;

    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const unsubscribe = subscribeToQueue(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  async function handleConfirmPayment(checkInId: string): Promise<void> {
    setBusyId(checkInId);
    setError(null);
    try {
      await api.confirmCheckInPaid(checkInId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm payment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckout(checkInId: string): Promise<void> {
    setBusyId(checkInId);
    setError(null);
    try {
      await api.checkoutCheckIn(checkInId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to check out');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Today&apos;s queue</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No check-ins yet today.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => {
            const status = displayStatus(item);
            return (
              <li key={item.checkInId} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link to={`/patients/${item.patientId}`} className="min-w-0 flex-1 hover:underline">
                  <p className="truncate font-medium text-slate-900">{item.patientName}</p>
                  <p className="text-xs text-slate-500">
                    {item.patientCode} · {item.departmentName} · {item.assignedDoctorName ?? 'Unassigned'}
                  </p>
                </Link>
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {STATUS_LABEL[status] ?? status}
                </span>
                <span className="w-16 shrink-0 text-right text-sm text-slate-500">KES {item.amountKes}</span>
                <div className="w-32 shrink-0 text-right">
                  {isUnresolvedPayment(item) && (
                    <button
                      onClick={() => void handleConfirmPayment(item.checkInId)}
                      disabled={busyId === item.checkInId}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                    >
                      Confirm payment
                    </button>
                  )}
                  {item.encounterStatus === 'READY_FOR_CHECKOUT' && (
                    <button
                      onClick={() => void handleCheckout(item.checkInId)}
                      disabled={busyId === item.checkInId}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      Checkout
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
