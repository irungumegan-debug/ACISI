import { api } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';

/** Unpaid ACISI check-in fees (C20): ACISI ID and amounts only. No names, no health data. */
export function PendingFeesPage() {
  const { data, error, loading } = useLoad(() => api.pendingFees(), []);

  return (
    <>
      <PageHeader title="Unpaid fees" subtitle="ACISI check-in fees that didn't go through. Patients pay them from their profile." />
      {loading && !data && <Loading />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && (
        <Card>
          <p className="mb-3 text-sm text-slate-600">
            Total unpaid: <strong>KSh {data.totalKes.toLocaleString()}</strong> · {data.rows.length} patient
            {data.rows.length === 1 ? '' : 's'} · {data.restrictedCount} restricted
            {!data.restrictionEnabled && ' (restriction is switched off: FEE_RESTRICTION_ENABLED)'}
          </p>
          {data.rows.length === 0 ? (
            <Empty>No unpaid fees.</Empty>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-2">ACISI ID</th>
                  <th>Unpaid</th>
                  <th>Fees</th>
                  <th>Oldest</th>
                  <th>Restricted</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.patientCode} className="border-t border-slate-100">
                    <td className="py-2 font-mono">{r.patientCode}</td>
                    <td>KSh {r.owedKes.toLocaleString()}</td>
                    <td>{r.count}</td>
                    <td>{new Date(r.oldestAt).toLocaleDateString('en-KE')}</td>
                    <td>{r.restricted ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
