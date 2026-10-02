import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDateTime, formatKes } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { ActiveBadge, Badge, Button, Card, Empty, ErrorText, Loading, PageHeader, TableWrap, td, th } from '../components/ui';
import { StaffTable } from '../components/StaffTable';
import { DeletedBadge, EncounterBadge } from '../components/StatusBadges';

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
          ['USSD code', clinic.ussdCode],
          ['Invite code', clinic.inviteCode],
          ['Visits', clinic.visitCount.toLocaleString()],
          ['Fees collected', formatKes(clinic.revenueKes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
            <p className="mt-1 break-all font-semibold tabular-nums text-stone-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <Card title="Departments">
          <div className="flex flex-wrap gap-2">
            {clinic.departments.map((d) => (
              <Badge key={d.id} tone={d.isActive ? 'stone' : 'red'}>
                {d.name}
                {!d.isActive && ' (inactive)'}
              </Badge>
            ))}
          </div>
        </Card>

        <Card title={`Staff (${clinic.staff.length})`}>
          {clinic.staff.length === 0 ? <Empty>No staff yet.</Empty> : <StaffTable staff={clinic.staff} showClinic={false} onChanged={reload} />}
        </Card>

        <Card title="Recent visits">
          {clinic.recentVisits.length === 0 ? (
            <Empty>No visits yet.</Empty>
          ) : (
            <TableWrap>
              <table className="min-w-full divide-y divide-stone-200">
                <thead>
                  <tr>
                    <th className={th}>Patient</th>
                    <th className={th}>Department</th>
                    <th className={th}>Status</th>
                    <th className={th}>Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {clinic.recentVisits.map((v) => (
                    <tr key={v.encounterId}>
                      <td className={td}>
                        <Link to={`/patients/${v.patientId}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                          {v.patientName}
                        </Link>{' '}
                        <span className="font-mono text-xs text-stone-500">{v.patientCode}</span>{' '}
                        {v.patientDeleted && <DeletedBadge />}
                      </td>
                      <td className={td}>{v.departmentName}</td>
                      <td className={td}>
                        <EncounterBadge status={v.status} />
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{formatDateTime(v.visitedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
