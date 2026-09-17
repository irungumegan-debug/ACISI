import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ConsultationStatus, Department, TodayQueueItem } from '../lib/api';
import { CheckoutModal } from '../components/CheckoutModal';

const STATUS_LABEL: Record<ConsultationStatus, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
  DONE: 'Done',
};

const STATUS_PILL_CLASS: Record<ConsultationStatus, string> = {
  WAITING: 'bg-gold-100 text-gold-700',
  IN_CONSULTATION: 'bg-navy-100 text-navy-700',
  DONE: 'bg-slate-200 text-slate-600',
};

/** Polling, not SSE/websockets — enough to pick up a USSD/web check-in or
 * another staff tab's status change within a few seconds, with none of the
 * complexity of reshaping the existing payment-only SSE feed into this view. */
const POLL_INTERVAL_MS = 5000;

export function QueuePage() {
  const [items, setItems] = useState<TodayQueueItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutTarget, setCheckoutTarget] = useState<TodayQueueItem | null>(null);
  const [busyEncounterId, setBusyEncounterId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const res = await api.getTodayQueue(selectedDepartment ?? undefined);
    setItems(res.queue);
  }, [selectedDepartment]);

  useEffect(() => {
    api
      .getDepartments()
      .then((res) => setDepartments(res.departments))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadQueue().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const interval = setInterval(() => void loadQueue(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadQueue]);

  async function handleStart(encounterId: string): Promise<void> {
    setBusyEncounterId(encounterId);
    try {
      await api.startConsultation(encounterId);
      await loadQueue();
    } finally {
      setBusyEncounterId(null);
    }
  }

  async function handleCheckoutSubmit(input: { notes: string; prescription: string }): Promise<void> {
    if (!checkoutTarget) return;
    await api.checkout(checkoutTarget.encounterId, {
      notes: input.notes.trim() || undefined,
      prescription: input.prescription.trim() || undefined,
    });
    setCheckoutTarget(null);
    await loadQueue();
  }

  const waitingCount = items.filter((i) => i.consultationStatus === 'WAITING').length;
  const inConsultationCount = items.filter((i) => i.consultationStatus === 'IN_CONSULTATION').length;
  const doneCount = items.filter((i) => i.consultationStatus === 'DONE').length;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-navy-900">Today&apos;s queue</h1>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatTile label="Waiting" value={waitingCount} />
        <StatTile label="In consultation" value={inConsultationCount} />
        <StatTile label="Checked out today" value={doneCount} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip label="All departments" active={selectedDepartment === null} onClick={() => setSelectedDepartment(null)} />
        {departments.map((d) => (
          <FilterChip
            key={d.id}
            label={d.name}
            active={selectedDepartment === d.id}
            onClick={() => setSelectedDepartment(d.id)}
          />
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No patients checked in yet today.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.encounterId} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link to={`/patients/${item.patientId}`} className="font-medium text-navy-900 hover:underline">
                    {item.patientName}
                  </Link>
                  <p className="text-sm text-slate-500">
                    {item.phoneNumber} · {item.departmentName} ·{' '}
                    {new Date(item.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_PILL_CLASS[item.consultationStatus]}`}
                  >
                    {STATUS_LABEL[item.consultationStatus]}
                  </span>
                  {item.consultationStatus === 'WAITING' && (
                    <button
                      onClick={() => void handleStart(item.encounterId)}
                      disabled={busyEncounterId === item.encounterId}
                      className="rounded-md border border-navy-300 px-3 py-1.5 text-sm text-navy-700 hover:border-navy-500 disabled:opacity-60"
                    >
                      Start consultation
                    </button>
                  )}
                  {item.consultationStatus === 'IN_CONSULTATION' && (
                    <button
                      onClick={() => setCheckoutTarget(item)}
                      className="rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:bg-gold-600"
                    >
                      Check out
                    </button>
                  )}
                  {item.consultationStatus === 'DONE' && <span className="text-sm text-slate-400">Complete</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {checkoutTarget && (
        <CheckoutModal item={checkoutTarget} onCancel={() => setCheckoutTarget(null)} onSubmit={handleCheckoutSubmit} />
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-2xl font-semibold text-navy-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ${
        active ? 'bg-navy-700 text-white' : 'border border-slate-300 text-slate-600 hover:border-navy-400'
      }`}
    >
      {label}
    </button>
  );
}
