import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, EncounterDetail } from '../lib/api';

export function DoctorEncounterPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [encounter, setEncounter] = useState<EncounterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .getDoctorEncounter(id)
      .then((res) => {
        if (!cancelled) setEncounter(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load patient');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitConsultation(id, diagnosis, prescription);
      navigate('/doctor/queue', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit consultation');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error && !encounter) return <p className="text-sm text-red-600">{error}</p>;
  if (!encounter) return null;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{encounter.patientName}</h1>
        <p className="mb-4 text-sm text-slate-500">
          {encounter.patientCode} · {encounter.phoneNumber}
        </p>

        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Visit history</p>
        {encounter.history.length === 0 && !encounter.hasHiddenHistoryElsewhere && (
          <p className="text-sm text-slate-500">No prior visits on record.</p>
        )}
        <ul className="space-y-3 border-l border-slate-200 pl-4">
          {encounter.history.map((h) => (
            <li key={h.encounterId}>
              <p className="text-xs text-slate-500">
                {new Date(h.visitedAt).toLocaleDateString()} · {h.clinicName}
                {!h.isOwnClinic && ' (shared)'}
              </p>
              {h.diagnosis && (
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Diagnosis:</span> {h.diagnosis}
                </p>
              )}
              {h.prescription && (
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Prescription:</span> {h.prescription}
                </p>
              )}
            </li>
          ))}
        </ul>
        {encounter.hasHiddenHistoryElsewhere && (
          <p className="mt-3 text-sm italic text-slate-500">
            This patient has prior visits at other ACISI clinics, but they haven&apos;t consented to sharing that history
            with this clinic.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Today&apos;s consultation</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="diagnosis">
              Diagnosis / notes
            </label>
            <textarea
              id="diagnosis"
              required
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="What did you find?"
              className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="prescription">
              Prescription
            </label>
            <textarea
              id="prescription"
              required
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              placeholder="Medication, dosage, duration"
              className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send to front desk for checkout'}
          </button>
          <p className="text-xs text-slate-500">
            This doesn&apos;t check the patient out — front desk confirms payment and sends the visit summary.
          </p>
        </form>
      </div>
    </div>
  );
}
