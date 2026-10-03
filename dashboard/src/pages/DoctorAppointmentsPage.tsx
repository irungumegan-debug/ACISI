import { useEffect, useState } from 'react';
import { api, DoctorAppointmentItem } from '../lib/api';
import { CalendarDays } from 'lucide-react';
import { Avatar, Card, EmptyState, SkeletonList } from '../components/ui';

/**
 * Read-only for a doctor — confirming/cancelling is front desk's job (see
 * AppointmentsPage). This just answers "who's expected today," separate from
 * the live WAITING/IN_CONSULTATION queue on DoctorQueuePage.
 */
export function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = useState<DoctorAppointmentItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getDoctorAppointmentsToday().then((res) => {
      if (!cancelled) setAppointments(res.appointments);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Today&apos;s appointments</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Confirmed bookings for today in your department — not yet checked in.</p>

      {appointments === null ? (
        <SkeletonList rows={3} label="Loading appointments" />
      ) : appointments.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} tone="gold" title="No confirmed appointments for today." />
        </Card>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-gold-500/30 pl-6">
          {appointments.map((a) => (
            <li key={a.id} className="relative">
              <span aria-hidden className="absolute -left-[33px] top-5 h-4 w-4 rounded-full bg-white ring-2 ring-gold-500" />
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
                <span className="w-16 flex-none rounded-xl bg-navy-900 py-2 text-center font-display text-sm font-bold text-gold-300 tabular-nums">
                  {new Date(a.scheduledFor).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
                <Avatar name={a.patientName} />
                <div className="min-w-0">
                  <p className="truncate font-display font-semibold text-navy-900">{a.patientName}</p>
                  <p className="text-xs text-ink-500">{a.patientCode}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
