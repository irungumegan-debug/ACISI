import { useEffect, useState } from 'react';
import { api, ActivityEntry, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';
import { ActivityList } from '../components/ActivityList';

const FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'OWNER', label: 'Owner' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'PATIENT', label: 'Patients' },
  { value: 'SYSTEM', label: 'System' },
];

export function ActivityPage() {
  const { handleExpired } = useAuth();
  const [actorType, setActorType] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const page = await api.activity({ actorType: actorType || undefined, before });
      setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
      setHasMore(page.hasMore);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleExpired();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType]);

  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="Every recorded action on the platform, newest first. This log can't be edited or deleted — by anyone."
      />
      <div className="mb-4 inline-flex flex-wrap rounded-md border border-stone-300 bg-white p-0.5 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setActorType(f.value)}
            className={`rounded px-3 py-1 ${actorType === f.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        {loading && entries.length === 0 ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <>
            <ActivityList entries={entries} showEntity />
            {hasMore && (
              <div className="mt-4 text-center">
                <Button onClick={() => void load(entries[entries.length - 1]?.createdAt)} disabled={loading}>
                  {loading ? 'Loading…' : 'Load older'}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
