import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, EncounterDetail } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Building2, FileText, Lock, NotebookPen, Phone, Pill, ShieldCheck, Stethoscope } from 'lucide-react';
import { Avatar, btn, EmptyState, field, SkeletonList, StatusBadge } from '../components/ui';

const textarea = `${field.input} min-h-36 resize-y py-3 text-base leading-relaxed sm:text-[15px]`;

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

  if (loading) return <SkeletonList rows={3} label="Loading the patient" />;
  if (error && !encounter)
    return (
      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  if (!encounter) return null;

  return (
    <div>
      <p className="mb-3 text-sm">
        <Link to="/doctor/queue" className="inline-flex items-center gap-1.5 font-medium text-ink-500 hover:text-navy-900">
          <ArrowLeft size={16} aria-hidden /> Back to my queue
        </Link>
      </p>
      <div className="relative mb-6 flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-900 to-navy-950 p-5 text-white shadow-raised ring-1 ring-gold-500/40 sm:p-6">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-foil" />
        <Avatar name={encounter.patientName} size="lg" className="ring-2 ring-gold-400/60" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-300">Now seeing</p>
          <h1 className="truncate font-display text-2xl font-bold tracking-tight">{encounter.patientName}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-300">
            {encounter.patientCode}
            <span className="inline-flex items-center gap-1.5">
              <Phone size={13} aria-hidden className="text-gold-400" /> {encounter.phoneNumber}
            </span>
          </p>
        </div>
        <StatusBadge status={encounter.status} />
      </div>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="order-2 lg:order-1">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-700">
          <FileText size={16} aria-hidden className="text-gold-700" /> Visit history
        </h2>
        {encounter.history.length === 0 && !encounter.hasHiddenHistoryElsewhere && (
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card">
            <EmptyState icon={FileText} title="No prior visits on record." />
          </div>
        )}
        <ol className="space-y-3 border-l-2 border-gold-500/30 pl-5">
          {encounter.history.map((h) => (
            <li key={h.encounterId} className="relative">
              <span aria-hidden className="absolute -left-[29px] top-4 h-3.5 w-3.5 rounded-full bg-white ring-2 ring-gold-500" />
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <Building2 size={13} aria-hidden />
                {new Date(h.visitedAt).toLocaleDateString()} · {h.clinicName}
                {!h.isOwnClinic && ' (shared)'}
              </p>
              {h.diagnosis && (
                <p className="mt-2 flex items-start gap-2 text-sm text-ink-700">
                  <Stethoscope size={15} aria-hidden className="mt-0.5 flex-none text-teal-700" />
                  <span>
                    <span className="font-semibold text-navy-900">Diagnosis:</span> {h.diagnosis}
                  </span>
                </p>
              )}
              {h.prescription && (
                <p className="mt-1.5 flex items-start gap-2 text-sm text-ink-700">
                  <Pill size={15} aria-hidden className="mt-0.5 flex-none text-gold-700" />
                  <span>
                    <span className="font-semibold text-navy-900">Prescription:</span> {h.prescription}
                  </span>
                </p>
              )}
              </div>
            </li>
          ))}
        </ol>
        {encounter.hasHiddenHistoryElsewhere && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-cream-200/60 px-3.5 py-3 text-sm text-ink-500">
            <Lock size={15} aria-hidden className="mt-0.5 flex-none" />
            This patient has prior visits at other ACISI clinics, but they haven&apos;t consented to sharing that history
            with this clinic.
          </p>
        )}
      </div>

      <div className="order-1 h-fit rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-7 lg:order-2">
        <ol className="mb-5 flex items-center gap-2 text-sm" aria-label="Progress">
          <li className={`flex items-center gap-2 ${step === 'edit' ? 'font-semibold text-navy-900' : 'text-ink-500'}`} aria-current={step === 'edit' ? 'step' : undefined}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step === 'edit' ? 'bg-foil text-navy-900' : 'bg-emerald-500 text-white'}`}>1</span>
            Write notes
          </li>
          <span aria-hidden className="h-0.5 flex-1 rounded bg-slate-200" />
          <li className={`flex items-center gap-2 ${step === 'sign' ? 'font-semibold text-navy-900' : 'text-ink-500'}`} aria-current={step === 'sign' ? 'step' : undefined}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step === 'sign' ? 'bg-foil text-navy-900' : 'bg-white text-ink-400 ring-1 ring-slate-300'}`}>2</span>
            Sign
          </li>
        </ol>
        {step === 'edit' ? (
          <>
            <h2 className="mb-5 flex items-center gap-2.5 font-display text-xl font-semibold text-navy-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-tint text-gold-700">
                <NotebookPen size={18} aria-hidden />
              </span>
              Today&apos;s consultation
            </h2>
            <form onSubmit={handleContinueToSign} className="space-y-5">
              <div>
                <label className={field.label} htmlFor="diagnosis">
                  Diagnosis / notes
                </label>
                <textarea
                  id="diagnosis"
                  required
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="What did you find?"
                  className={textarea}
                />
              </div>
              <div>
                <label className={field.label} htmlFor="prescription">
                  Prescription
                </label>
                <textarea
                  id="prescription"
                  required
                  value={prescription}
                  onChange={(e) => setPrescription(e.target.value)}
                  placeholder="Medication, dosage, duration"
                  className={textarea}
                />
              </div>
              <button type="submit" className={`${btn.gold} w-full`}>
                Continue to sign
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="mb-1 flex items-center gap-2.5 font-display text-xl font-semibold text-navy-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-tint text-gold-700">
                <ShieldCheck size={18} aria-hidden />
              </span>
              Confirm and sign
            </h2>
            <p className="mb-5 text-sm text-ink-500">
              {session?.staffName} · {ROLE_LABEL[session?.role ?? ''] ?? session?.role}
            </p>
            <form onSubmit={(e) => void handleSign(e)} className="space-y-4">
              <div className="space-y-3 rounded-2xl bg-cream-100 p-4 text-sm">
                <p className="flex items-start gap-2 text-ink-700">
                  <Stethoscope size={15} aria-hidden className="mt-0.5 flex-none text-teal-700" />
                  <span className="whitespace-pre-wrap">{diagnosis}</span>
                </p>
                <p className="flex items-start gap-2 text-ink-700">
                  <Pill size={15} aria-hidden className="mt-0.5 flex-none text-gold-700" />
                  <span className="whitespace-pre-wrap">{prescription}</span>
                </p>
                <p className="border-t border-slate-200 pt-3 font-medium text-navy-900">I confirm this prescription is accurate and complete.</p>
              </div>
              <div>
                <label className={field.label} htmlFor="sign-pin">
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
                  className={`${field.input} max-w-xs text-center font-mono text-lg tracking-[0.4em]`}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('edit');
                    setError(null);
                  }}
                  disabled={submitting}
                  className={`${btn.secondary} flex-1`}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || !pin}
                  className={`${btn.gold} flex-1`}
                >
                  {submitting ? 'Signing…' : 'Confirm & Sign'}
                </button>
              </div>
              <p className="text-xs text-ink-500">
                This doesn&apos;t check the patient out — front desk confirms payment and sends the visit summary.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
