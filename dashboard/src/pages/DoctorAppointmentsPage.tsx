import { useEffect, useState } from 'react';
import { api, DoctorAppointmentItem } from '../lib/api';

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
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Today&apos;s appointments</h1>
      <p className="mb-4 text-sm text-slate-500">Confirmed bookings for today in your department — not yet checked in.</p>

      {appointments === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : appointments.length === 0 ? (
        <p className="text-sm text-slate-500">No confirmed appointments for today.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{a.patientName}</p>
                <p className="text-xs text-slate-500">{a.patientCode}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-slate-500">{new Date(a.scheduledFor).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
