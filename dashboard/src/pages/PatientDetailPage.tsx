import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, PatientDetail, PatientIdentity, PatientIdentityRecord } from '../lib/api';
import { ArrowLeft, Building2, CalendarDays, FileText, IdCard, Lock, MessageSquareOff, Phone, Stethoscope } from 'lucide-react';
import { Avatar, btn, Card, EmptyState, SkeletonList } from '../components/ui';
import { ID_TYPE_LABEL, IdentityFields } from '../components/IdentityFields';

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

  if (loading) return <SkeletonList rows={3} label="Loading the patient" />;

  if (error || !patient) {
    return (
      <div>
        <Link to="/patients" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-navy-900">
          <ArrowLeft size={16} aria-hidden /> Back to patients
        </Link>
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? 'Patient not found'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link to="/patients" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-navy-900">
        <ArrowLeft size={16} aria-hidden /> Back to patients
      </Link>
      <div className="mb-6 mt-4 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-navy-800 to-navy-950 p-5 text-white shadow-raised">
        <Avatar name={`${patient.firstName} ${patient.lastName}`} size="lg" className="ring-2 ring-gold-400/60" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold tracking-tight">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Phone size={14} aria-hidden className="text-gold-400" /> {patient.phoneNumber}
            </span>
            {patient.dateOfBirth && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} aria-hidden className="text-gold-400" /> Born {new Date(patient.dateOfBirth).getFullYear()}
              </span>
            )}
          </p>
        </div>
      </div>

      <SmsPreference patientId={patient.id} initial={patient.smsOptOut} onChange={(smsOptOut) => setPatient({ ...patient, smsOptOut })} />

      <IdentityCard patient={patient} onSaved={(saved) => setPatient({ ...patient, ...saved })} />

      <Card title="Visit history" icon={FileText}>
      {patient.history.length === 0 && !patient.hasHiddenHistoryElsewhere ? (
        <EmptyState icon={FileText} title="No prior visits on record." />
      ) : (
        <ol className="relative space-y-4 border-l-2 border-gold-500/30 pl-6">
          {patient.history.map((entry) => (
            <li key={entry.encounterId} className="relative">
              <span aria-hidden className="absolute -left-[33px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-gold-500">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
              </span>
              <div className="rounded-2xl border border-slate-200 bg-cream-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-medium text-navy-900">
                    <Building2 size={15} aria-hidden className="text-gold-700" />
                    {entry.clinicName}
                    {!entry.isOwnClinic && ' (shared)'}
                  </span>
                  <span className="text-sm text-ink-500">{new Date(entry.visitedAt).toLocaleDateString()}</span>
                </div>
                {(entry.diagnosis || entry.prescription) && (
                  <p className="mt-2 flex items-start gap-2 text-sm text-ink-700">
                    <Stethoscope size={15} aria-hidden className="mt-0.5 flex-none text-teal-700" />
                    <span>
                      {entry.diagnosis}
                      {entry.diagnosis && entry.prescription ? ' — ' : ''}
                      {entry.prescription}
                    </span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {patient.hasHiddenHistoryElsewhere && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-cream-100 px-3.5 py-3 text-sm text-ink-500">
          <Lock size={15} aria-hidden className="mt-0.5 flex-none" />
          This patient has prior visits at other ACISI clinics, but they haven&apos;t consented to sharing that history
          with this clinic.
        </p>
      )}
      </Card>
    </div>
  );
}

/** "Patient does not want SMS" — front desk can set it for any patient (e.g. ones who checked in remotely). */
function SmsPreference({ patientId, initial, onChange }: { patientId: string; initial: boolean; onChange: (v: boolean) => void }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session?.role === 'DOCTOR') return null;

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setSmsPreference(patientId, next);
      onChange(res.smsOptOut);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the SMS preference.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mb-6 rounded-2xl border p-4 shadow-card ${initial ? 'border-red-200 bg-red-50/60' : 'border-slate-200/80 bg-white'}`}>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-700">
        <input type="checkbox" checked={initial} disabled={busy} onChange={(e) => void toggle(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900" />
        <MessageSquareOff size={18} aria-hidden className={`mt-0.5 flex-none ${initial ? 'text-red-700' : 'text-ink-400'}`} />
        <span>
          <span className="font-semibold text-navy-900">Patient does not want SMS</span>
          <span className="block text-ink-500">No payment receipts, visit summaries or invites will be texted.</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const toForm = (r: PatientIdentityRecord): PatientIdentity => ({
  idType: r.idType ?? '',
  idNumber: r.idNumber ?? '',
  nextOfKinName: r.nextOfKinName ?? '',
  nextOfKinPhone: r.nextOfKinPhone ?? '',
});

/** ID document and next of kin: everyone can see them; front desk can edit (emptying a field removes it). */
function IdentityCard({ patient, onSaved }: { patient: PatientDetail; onSaved: (saved: PatientIdentityRecord) => void }) {
  const { session } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PatientIdentity>(toForm(patient));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = session?.role !== 'DOCTOR';

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updatePatientDetails(patient.id, form);
      onSaved(saved);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the details.');
    } finally {
      setBusy(false);
    }
  }

  const row = (term: string, value: string | null) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-40 flex-none text-ink-500">{term}</dt>
      <dd className="font-medium text-navy-900">{value || <span className="font-normal text-ink-400">Not recorded</span>}</dd>
    </div>
  );

  return (
    <Card title="ID and next of kin" icon={IdCard} className="mb-6">
        {!editing ? (
          <>
            <dl className="space-y-2.5 text-sm">
              {row('ID document', patient.idType ? `${ID_TYPE_LABEL[patient.idType]} ${patient.idNumber ?? ''}` : null)}
              {row('Next of kin', patient.nextOfKinName)}
              {row('Next of kin phone', patient.nextOfKinPhone)}
            </dl>
            {canEdit && (
              <button
                type="button"
                className={`${btn.secondary} mt-4`}
                onClick={() => {
                  setForm(toForm(patient));
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
          </>
        ) : (
          <form onSubmit={(e) => void save(e)}>
            <IdentityFields idPrefix="patient" value={form} onChange={setForm} />
            <p className="mt-2 text-xs text-ink-500">Empty a field to remove it from the record.</p>
            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={btn.gold}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={busy} className={btn.secondary} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
    </Card>
  );
}
