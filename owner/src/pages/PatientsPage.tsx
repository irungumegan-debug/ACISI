import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PatientStatusFilter } from '../lib/api';
import { formatDate } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';
import { useLoad } from '../lib/useLoad';
import { Card, Empty, ErrorText, Loading, PageHeader, SearchBox, TableWrap, td, th } from '../components/ui';
import { DeletedBadge } from '../components/StatusBadges';

const FILTERS: { value: PatientStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'all', label: 'All' },
];

export function PatientsPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PatientStatusFilter>('active');
  const q = useDebounced(query.trim());
  const { data, error, loading } = useLoad(() => api.patients(q, status), [q, status]);

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Every patient on ACISI, across all clinics. Opening a patient's record is recorded in the activity log."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, phone, patient ID or email" />
        <div className="inline-flex self-start rounded-md border border-stone-300 bg-white p-0.5 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`rounded px-3 py-1 ${status === f.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : data && data.patients.length === 0 ? (
          <Empty>{q ? 'No patients match that search.' : 'No patients yet.'}</Empty>
        ) : (
          <>
            {!q && <p className="mb-3 text-xs text-stone-500">Showing the 50 most recently registered. Search to find anyone else.</p>}
            <TableWrap>
              <table className="min-w-full divide-y divide-stone-200">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Patient ID</th>
                    <th className={th}>Phone</th>
                    <th className={th}>Visits</th>
                    <th className={th}>Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.patients.map((p) => (
                    <tr key={p.id} className="hover:bg-stone-50">
                      <td className={td}>
                        <Link to={`/patients/${p.id}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                          {p.firstName} {p.lastName}
                        </Link>{' '}
                        {p.deletedAt && <DeletedBadge />}
                      </td>
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>{p.patientCode}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{p.phoneNumber ?? '—'}</td>
                      <td className={`${td} tabular-nums`}>{p.visitCount}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Card>
    </>
  );
}
