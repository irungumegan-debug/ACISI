import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PatientListItem } from '../lib/api';

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
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Patients</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by phone or name"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Search
        </button>
      </form>

      {loading && <p className="text-sm text-slate-500">Searching…</p>}
      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-slate-500">No patients found at your clinic matching &quot;{query}&quot;.</p>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {results.map((patient) => (
            <li key={patient.id}>
              <Link to={`/patients/${patient.id}`} className="block px-4 py-3 hover:bg-slate-50">
                <p className="font-medium text-slate-900">
                  {patient.firstName} {patient.lastName}
                </p>
                <p className="text-sm text-slate-500">{patient.phoneNumber}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
