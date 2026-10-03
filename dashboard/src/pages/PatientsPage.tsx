import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PatientListItem } from '../lib/api';
import { ChevronRight, Search, SearchX, UserRound } from 'lucide-react';
import { Avatar, btn, Card, EmptyState, field, SkeletonList } from '../components/ui';

export function PatientsPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientListItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      const res = await api.searchPatients(query.trim());
      setResults(res.patients);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Patients</h1>
      <p className="mb-5 mt-1 text-sm text-ink-500">Find a patient at your clinic by phone number or name.</p>
      <form onSubmit={(e) => void handleSubmit(e)} className="mb-6 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search by phone or name</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by phone or name"
            className={`${field.input} pl-10 text-base sm:text-[15px]`}
          />
        </label>
        <button type="submit" className={btn.gold}>
          Search
        </button>
      </form>

      {loading && <SkeletonList rows={3} label="Searching" />}
      {!loading && !searched && results.length === 0 && (
        <Card>
          <EmptyState icon={UserRound} tone="gold" title="Search for a patient">
            Type at least two letters of a name, or part of a phone number.
          </EmptyState>
        </Card>
      )}
      {!loading && searched && results.length === 0 && (
        <Card>
          <EmptyState icon={SearchX} title="No patients found">
            No patients found at your clinic matching &quot;{query}&quot;.
          </EmptyState>
        </Card>
      )}
      {!loading && results.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
          {results.map((patient) => (
            <li key={patient.id}>
              <Link to={`/patients/${patient.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-cream-50">
                <Avatar name={`${patient.firstName} ${patient.lastName}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy-900">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <span className="block text-sm text-ink-500">{patient.phoneNumber}</span>
                </span>
                <ChevronRight size={18} aria-hidden className="text-ink-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
