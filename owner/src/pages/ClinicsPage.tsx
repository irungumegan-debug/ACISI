import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ClinicListItem } from '../lib/api';
import { formatDate, formatKes } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';
import { useLoad } from '../lib/useLoad';
import { ActiveBadge, Card, Empty, ErrorText, Loading, PageHeader, SearchBox, TableWrap, td, th } from '../components/ui';

type SortKey = 'revenueKes' | 'revenueLast30DaysKes' | 'visitsLast30Days' | 'doctorCount' | 'createdAt' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'revenueKes', label: 'Total revenue' },
  { key: 'revenueLast30DaysKes', label: 'Revenue, last 30 days' },
  { key: 'visitsLast30Days', label: 'Visits, last 30 days' },
  { key: 'doctorCount', label: 'Doctors' },
  { key: 'createdAt', label: 'Newest' },
  { key: 'name', label: 'Name (A–Z)' },
];

function sortClinics(clinics: ClinicListItem[], key: SortKey): ClinicListItem[] {
  return [...clinics].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name);
    if (key === 'createdAt') return b.createdAt.localeCompare(a.createdAt);
    return b[key] - a[key];
  });
}

export function ClinicsPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('revenueKes');
  const q = useDebounced(query.trim());
  const { data, error, loading } = useLoad(() => api.clinics(q), [q]);
  const clinics = useMemo(() => (data ? sortClinics(data.clinics, sort) : []), [data, sort]);

  return (
    <>
      <PageHeader title="Clinics" subtitle="Every clinic registered on ACISI, with its revenue and activity. Open one to see its doctors and staff." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, county or USSD code" />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : clinics.length === 0 ? (
          <Empty>No clinics found.</Empty>
        ) : (
          <TableWrap>
            <table className="min-w-full divide-y divide-stone-200">
              <thead>
                <tr>
                  <th className={th}>Clinic</th>
                  <th className={`${th} text-right`}>Revenue</th>
                  <th className={`${th} text-right`}>Last 30 days</th>
                  <th className={`${th} text-right`}>Visits (30d)</th>
                  <th className={`${th} text-right`}>Doctors</th>
                  <th className={`${th} text-right`}>Staff</th>
                  <th className={th}>Joined</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {clinics.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className={td}>
                      <Link to={`/clinics/${c.id}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-stone-500">{c.county ?? 'No county'}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums text-stone-900`}>{formatKes(c.revenueKes)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKes(c.revenueLast30DaysKes)}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.visitsLast30Days}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.doctorCount}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.staffCount}</td>
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
