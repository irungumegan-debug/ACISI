import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, EncounterDetail } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ROLE_LABEL: Record<string, string> = {
  DOCTOR: 'Doctor',
  CLINICIAN: 'Clinician',
  RECEPTIONIST: 'Receptionist',
  ADMIN: 'Clinic Administrator',
};

type Step = 'edit' | 'sign';

export function DoctorEncounterPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [encounter, setEncounter] = useState<EncounterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [step, setStep] = useState<Step>('edit');
  const [pin, setPin] = useState('');
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

  function handleContinueToSign(e: FormEvent): void {
    e.preventDefault();
    if (!diagnosis.trim() || !prescription.trim()) return;
    setError(null);
    setStep('sign');
  }

  async function handleSign(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitConsultation(id, diagnosis, prescription, pin);
      navigate('/doctor/queue', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit consultation');
      setPin('');
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
        {step === 'edit' ? (
          <>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Today&apos;s consultation</h2>
            <form onSubmit={handleContinueToSign} className="space-y-4">
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
              <button
                type="submit"
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Continue to sign
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-base font-semibold text-slate-900">Confirm and sign</h2>
            <p className="mb-4 text-sm text-slate-500">
              {session?.staffName} · {ROLE_LABEL[session?.role ?? ''] ?? session?.role}
            </p>
            <form onSubmit={(e) => void handleSign(e)} className="space-y-4">
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                I confirm this prescription is accurate and complete.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="sign-pin">
                  Re-enter your PIN to sign
                </label>
                <input
                  id="sign-pin"
                  type="password"
                  inputMode="numeric"
                  required
                  maxLength={6}
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="PIN"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('edit');
                    setError(null);
                  }}
                  disabled={submitting}
                  className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || !pin}
                  className="flex-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {submitting ? 'Signing…' : 'Confirm & Sign'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                This doesn&apos;t check the patient out — front desk confirms payment and sends the visit summary.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
