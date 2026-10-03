import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatDate, formatKes } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { ActiveBadge, Badge, Button, Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';
import { StaffTable } from '../components/StaffTable';

export function ClinicDetailPage() {
  const { id = '' } = useParams();
  const { data: clinic, error, loading, reload } = useLoad(() => api.clinic(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleActive(): Promise<void> {
    if (!clinic) return;
    const message = clinic.isActive
      ? `Deactivate ${clinic.name}?\n\nAll of its staff will be logged out and unable to sign in, and patients will no longer be able to check in or book there. Its records are kept, and you can reactivate it later.`
      : `Reactivate ${clinic.name}?\n\nIts staff will be able to sign in again and patients can check in and book there.`;
    if (!window.confirm(message)) return;

    setBusy(true);
    setActionError(null);
    try {
      await api.setClinicActive(clinic.id, !clinic.isActive);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !clinic) return <Loading />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!clinic) return null;

  const doctors = clinic.staff.filter((s) => s.role === 'DOCTOR');
  const otherStaff = clinic.staff.filter((s) => s.role !== 'DOCTOR');

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/clinics" className="text-stone-500 hover:text-stone-900">
          ← All clinics
        </Link>
      </p>
      <PageHeader
        title={clinic.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ActiveBadge isActive={clinic.isActive} />
            <span>{clinic.county ?? 'No county'}</span>
            <span>· Joined {formatDate(clinic.createdAt)}</span>
          </span>
        }
        actions={
          <Button tone={clinic.isActive ? 'danger' : 'primary'} onClick={() => void toggleActive()} disabled={busy}>
            {clinic.isActive ? 'Deactivate clinic' : 'Reactivate clinic'}
          </Button>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorText>{actionError}</ErrorText>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Total revenue', formatKes(clinic.revenueKes), `${formatKes(clinic.revenueLast30DaysKes)} in the last 30 days`],
          ['Visits', clinic.visitCount.toLocaleString(), `${clinic.visitsLast30Days} in the last 30 days`],
          ['Upcoming appointments', clinic.upcomingAppointments.toLocaleString(), null],
          ['Doctors', String(doctors.filter((d) => d.isActive).length), `${otherStaff.filter((s) => s.isActive).length} other staff`],
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-stone-900">{value}</p>
            {detail && <p className="text-xs text-stone-500">{detail}</p>}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <Card title={`Doctors (${doctors.length})`}>
          {doctors.length === 0 ? <Empty>No doctors have joined yet.</Empty> : <StaffTable staff={doctors} kind="doctors" onChanged={reload} />}
        </Card>

        <Card title={`Front desk & admin (${otherStaff.length})`}>
          {otherStaff.length === 0 ? <Empty>No staff yet.</Empty> : <StaffTable staff={otherStaff} kind="staff" onChanged={reload} />}
        </Card>

        <Card title="Clinic details">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">USSD code</dt>
              <dd className="mt-0.5 tabular-nums text-stone-900">{clinic.ussdCode}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Staff invite code</dt>
              <dd className="mt-0.5 font-mono text-stone-900">{clinic.inviteCode}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">Departments</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {clinic.departments.map((d) => (
                  <Badge key={d.id} tone={d.isActive ? 'stone' : 'red'}>
                    <span className="font-mono text-[10px] tracking-wider opacity-70">{d.code}</span> {d.name}
                    {!d.isActive && ' (inactive)'}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
