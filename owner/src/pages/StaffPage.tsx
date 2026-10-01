import { useState } from 'react';
import { api } from '../lib/api';
import { useDebounced } from '../lib/useDebounced';
import { useLoad } from '../lib/useLoad';
import { Card, Empty, ErrorText, Loading, PageHeader, SearchBox } from '../components/ui';
import { StaffTable } from '../components/StaffTable';

export function StaffPage() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const { data, error, loading, reload } = useLoad(() => api.staff(q), [q]);

  return (
    <>
      <PageHeader
        title="Staff & doctors"
        subtitle="Everyone who works at an ACISI clinic. Deactivating someone logs them out and blocks their sign-in; it can be undone."
      />
      <div className="mb-4">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, staff ID, phone or clinic" />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : data && data.staff.length === 0 ? (
          <Empty>No staff found.</Empty>
        ) : (
          data && <StaffTable staff={data.staff} showClinic onChanged={reload} />
        )}
      </Card>
    </>
  );
}
