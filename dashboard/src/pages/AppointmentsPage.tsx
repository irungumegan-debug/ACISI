import { useEffect, useState } from 'react';
import { api, ApiError, ClinicAppointmentItem } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

const STATUS_CLASS: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
};

export function AppointmentsPage() {
  const [appointments, setAppointments] = useState<ClinicAppointmentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh(): void {
    api
      .getClinicAppointments()
      .then((res) => setAppointments(res.appointments))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load appointments'));
  }

  useEffect(refresh, []);

  async function handleConfirm(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await api.confirmAppointment(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm appointment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id: string): Promise<void> {
    if (!confirm('Cancel this appointment?')) return;
    setBusyId(id);
    setError(null);
    try {
      await api.cancelAppointment(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel appointment');
    } finally {
      setBusyId(null);
    }
  }

  async function handleArrive(id: string): Promise<void> {
    if (!confirm("Check this patient in now? This sends an M-Pesa prompt to their phone, same as any check-in.")) return;
    setBusyId(id);
    setError(null);
    try {
      await api.arriveAppointment(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to check the patient in');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Appointments</h1>
      <p className="mb-4 text-sm text-slate-500">Today&apos;s and future bookings — separate from the live walk-in queue.</p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {appointments === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : appointments.length === 0 ? (
        <p className="text-sm text-slate-500">No upcoming appointments.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{a.patientName}</p>
                <p className="text-xs text-slate-500">
                  {a.patientCode} · {a.phoneNumber} · {a.departmentName}
                </p>
                <p className="text-xs text-slate-500">{new Date(a.scheduledFor).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[a.status] ?? ''}`}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
                {a.status === 'REQUESTED' && (
                  <button
                    onClick={() => void handleConfirm(a.id)}
                    disabled={busyId === a.id}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                {(a.status === 'REQUESTED' || a.status === 'CONFIRMED') && (
                  <>
                    <button
                      onClick={() => void handleArrive(a.id)}
                      disabled={busyId === a.id}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                    >
                      Patient arrived
                    </button>
                    <button
                      onClick={() => void handleCancel(a.id)}
                      disabled={busyId === a.id}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
