import { useEffect, useState } from 'react';
import { api, ApiError, ClinicAppointmentItem } from '../lib/api';
import { CalendarCheck, CalendarClock, CalendarDays, CalendarX, CheckCircle2, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, Badge, Card, EmptyState, SkeletonList, Tone } from '../components/ui';

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

const STATUS_TONE: Record<string, { tone: Tone; icon: LucideIcon }> = {
  REQUESTED: { tone: 'warning', icon: Clock },
  CONFIRMED: { tone: 'blue', icon: CalendarCheck },
  CANCELLED: { tone: 'neutral', icon: CalendarX },
  COMPLETED: { tone: 'success', icon: CheckCircle2 },
};

const actionBtn =
  'min-h-9 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-900 transition hover:border-gold-500 disabled:opacity-50';

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
      <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Appointments</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Today&apos;s and future bookings — separate from the live walk-in queue.</p>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {appointments === null ? (
        <SkeletonList rows={4} label="Loading appointments" />
      ) : appointments.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} tone="gold" title="No upcoming appointments">
            Bookings patients make online will show up here.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {appointments.map((a) => {
            const when = new Date(a.scheduledFor);
            const meta = STATUS_TONE[a.status];
            return (
            <li key={a.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div className="flex w-14 flex-none flex-col items-center rounded-xl bg-navy-900 py-1.5 text-white">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gold-300">{when.toLocaleDateString('en-KE', { month: 'short' })}</span>
                  <span className="font-display text-xl font-bold leading-tight">{when.getDate()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="hidden sm:inline-flex">
                      <Avatar name={a.patientName} size="sm" />
                    </span>
                    <span className="truncate font-display font-semibold text-navy-900">{a.patientName}</span>
                  </p>
                  <p className="mt-1 text-xs text-ink-500 [overflow-wrap:anywhere]">
                    {a.patientCode} · {a.phoneNumber} · {a.departmentName}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-ink-700">
                    <CalendarClock size={13} aria-hidden /> {when.toLocaleString()}
                  </p>
                </div>
                <Badge tone={meta?.tone ?? 'neutral'} icon={meta?.icon}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 empty:hidden">
                {a.status === 'REQUESTED' && (
                  <button
                    onClick={() => void handleConfirm(a.id)}
                    disabled={busyId === a.id}
                    className="min-h-9 rounded-full bg-navy-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-navy-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                {(a.status === 'REQUESTED' || a.status === 'CONFIRMED') && (
                  <>
                    <button
                      onClick={() => void handleArrive(a.id)}
                      disabled={busyId === a.id}
                      className={actionBtn}
                    >
                      Patient arrived
                    </button>
                    <button
                      onClick={() => void handleCancel(a.id)}
                      disabled={busyId === a.id}
                      className={`${actionBtn} hover:border-red-400 hover:text-red-700`}
                    >
                      Cancel
                    </button>
                  </>
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
