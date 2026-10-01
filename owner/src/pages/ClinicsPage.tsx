import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';
import { useLoad } from '../lib/useLoad';
import { ActiveBadge, Card, Empty, ErrorText, Loading, PageHeader, SearchBox, TableWrap, td, th } from '../components/ui';

export function ClinicsPage() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const { data, error, loading } = useLoad(() => api.clinics(q), [q]);

  return (
    <>
      <PageHeader title="Clinics" subtitle="Every clinic registered on ACISI." />
      <div className="mb-4">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, county or USSD code" />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : data && data.clinics.length === 0 ? (
          <Empty>No clinics found.</Empty>
        ) : (
          <TableWrap>
            <table className="min-w-full divide-y divide-stone-200">
              <thead>
                <tr>
                  <th className={th}>Clinic</th>
                  <th className={th}>County</th>
                  <th className={th}>USSD code</th>
                  <th className={th}>Staff</th>
                  <th className={th}>Visits</th>
                  <th className={th}>Joined</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data?.clinics.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className={td}>
                      <Link to={`/clinics/${c.id}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className={td}>{c.county ?? '—'}</td>
                    <td className={`${td} tabular-nums`}>{c.ussdCode}</td>
                    <td className={`${td} tabular-nums`}>{c.staffCount}</td>
                    <td className={`${td} tabular-nums`}>{c.visitCount}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(c.createdAt)}</td>
                    <td className={td}>
                      <ActiveBadge isActive={c.isActive} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
