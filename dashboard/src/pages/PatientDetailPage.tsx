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
      {patient.history.length === 0 && !patient.hasHiddenHistoryElsewhere ? (
        <p className="text-sm text-slate-500">No prior visits on record.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {patient.history.map((entry) => (
            <li key={entry.encounterId} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-900">
                  {entry.clinicName}
                  {!entry.isOwnClinic && ' (shared)'}
                </span>
                <span className="text-sm text-slate-500">{new Date(entry.visitedAt).toLocaleDateString()}</span>
              </div>
              {(entry.diagnosis || entry.prescription) && (
                <p className="mt-1 text-sm text-slate-600">
                  {entry.diagnosis}
                  {entry.diagnosis && entry.prescription ? ' — ' : ''}
                  {entry.prescription}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {patient.hasHiddenHistoryElsewhere && (
        <p className="mt-3 text-sm italic text-slate-500">
          This patient has prior visits at other ACISI clinics, but they haven&apos;t consented to sharing that history
          with this clinic.
        </p>
      )}
    </div>
  );
}
