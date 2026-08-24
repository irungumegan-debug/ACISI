import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, PatientDetail } from '../lib/api';

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getPatient(id)
      .then(setPatient)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load patient'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (error || !patient) {
    return (
      <div>
        <Link to="/patients" className="text-sm text-slate-600 hover:text-slate-900">
          &larr; Back to patients
        </Link>
        <p className="mt-4 text-sm text-red-600">{error ?? 'Patient not found'}</p>
      </div>
    );
  }

  return (
    <div>
      <Link to="/patients" className="text-sm text-slate-600 hover:text-slate-900">
        &larr; Back to patients
      </Link>
      <h1 className="mb-1 mt-4 text-lg font-semibold text-slate-900">
        {patient.firstName} {patient.lastName}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        {patient.phoneNumber}
        {patient.dateOfBirth ? ` · Born ${new Date(patient.dateOfBirth).getFullYear()}` : ''}
      </p>

      <h2 className="mb-2 text-sm font-medium text-slate-700">Visit history</h2>
      {patient.history.length === 0 ? (
        <p className="text-sm text-slate-500">No prior visits on record.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {patient.history.map((entry, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-900">{entry.clinicName}</span>
              <span className="text-sm text-slate-500">{new Date(entry.visitedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
