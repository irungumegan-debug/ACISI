import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, DepartmentOption, PatientIdentity, WalkInLookup, WalkInPatientMatch, WalkInResult } from '../lib/api';
import { EMPTY_IDENTITY, IdentityFields } from '../components/IdentityFields';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Check, CircleCheckBig, FileText, House, IdCard, MessageSquareOff, MessageSquareText, Search, UserPlus, UserRoundCheck } from 'lucide-react';
import { Avatar, btn, field } from '../components/ui';
import { AddPatientForm } from '../components/AddPatientForm';
import { describeBirth, PatientMatchList } from '../components/PatientMatchList';
import { legalBoxSatisfied, PRIVACY_PATH } from '../lib/legal';

const input = `${field.input} text-base sm:text-[15px]`;
const label = field.label;

const STEPS: { key: Step; label: string }[] = [
  { key: 'search', label: 'Find patient' },
  { key: 'details', label: 'Visit details' },
  { key: 'done', label: 'In the queue' },
];

/** Picking from several, or adding a new patient, still counts as "Find patient" in the progress bar. */
function progressStep(step: Step): Step {
  return step === 'pick' || step === 'add' ? 'search' : step;
}

function StepIndicator({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.key === progressStep(step));
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-bold ${
                done ? 'bg-emerald-500 text-white' : active ? 'bg-foil text-navy-900 shadow-gold' : 'bg-white text-ink-400 ring-1 ring-slate-300'
              }`}
            >
              {done ? <Check size={16} aria-hidden strokeWidth={3} /> : i + 1}
            </span>
            <span className={`hidden text-sm sm:inline ${active ? 'font-semibold text-navy-900' : 'text-ink-500'}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span aria-hidden className={`h-0.5 flex-1 rounded ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function formatLastVisit(iso: string | null): string {
  if (!iso) return 'No previous visit at this clinic';
  return `Last visit here: ${new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

type Step = 'search' | 'pick' | 'add' | 'details' | 'done';

/**
 * Front-desk check-in for a patient who walked in without checking in
 * remotely: find them by phone or ACISI ID (a phone can hold several
 * people — staff pick one), or add them if they're new, confirm name and
 * date of birth, then add them to the queue. No ACISI fee, no payment
 * prompt. They get an SMS on joining and one when they're next.
 */
export function WalkInPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [lookup, setLookup] = useState<WalkInLookup | null>(null);
  const [patient, setPatient] = useState<WalkInPatientMatch | null>(null);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [smsOptOut, setSmsOptOut] = useState(false);
  const [privacyNoticeExplained, setPrivacyNoticeExplained] = useState(false);
  const [identity, setIdentity] = useState<PatientIdentity>(EMPTY_IDENTITY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .getDepartments(session.clinicId)
      .then(({ departments: list }) => {
        setDepartments(list);
        const general = list.find((d) => d.name.toLowerCase() === 'general');
        setDepartmentId((general ?? list[0])?.id ?? '');
      })
      .catch(() => setError('Could not load departments. Refresh the page to try again.'));
  }, [session]);

  if (session?.role === 'DOCTOR') {
    return <Navigate to="/doctor/queue" replace />;
  }

  const privacyNoticeAckRequired = patient !== null && !isNewPatient && patient.privacyNoticeAckRequired;

  function startOver(): void {
    setStep('search');
    setQuery('');
    setLookup(null);
    setPatient(null);
    setIsNewPatient(false);
    setReason('');
    setIdentityConfirmed(false);
    setSmsOptOut(false);
    setPrivacyNoticeExplained(false);
    setIdentity(EMPTY_IDENTITY);
    setError(null);
    setResult(null);
  }

  function choose(p: WalkInPatientMatch, isNew = false): void {
    setPatient(p);
    setIsNewPatient(isNew);
    setIdentityConfirmed(isNew);
    setError(null);
    setStep('details');
  }

  async function handleSearch(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await api.lookupWalkIn(query);
      setLookup(found);
      if (found.patients.length === 0) setStep('add');
      else if (found.patients.length === 1 && found.kind === 'patientCode') choose(found.patients[0] as WalkInPatientMatch);
      else setStep('pick');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || !patient) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.checkInWalkIn({
        patientId: patient.id,
        identityConfirmed,
        departmentId,
        reasonForVisit: reason,
        smsConsent: false,
        smsOptOut,
        privacyNoticeExplained: privacyNoticeAckRequired && privacyNoticeExplained,
        identity,
      });
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      {error}
    </p>
  );

  return (
    <div className="mx-auto max-w-xl">
      <p className="mb-3 text-sm">
        <Link to="/queue" className="inline-flex items-center gap-1.5 font-medium text-ink-500 hover:text-navy-900">
          <ArrowLeft size={16} aria-hidden /> Back to queue
        </Link>
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Check in walk-in patient</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">For patients who arrived without checking in remotely. No ACISI check-in fee is charged.</p>
      <StepIndicator step={step} />

      {step === 'search' && (
        <form onSubmit={(e) => void handleSearch(e)} className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div>
            <label htmlFor="q" className={label}>
              Phone number or ACISI ID
            </label>
            <input
              id="q"
              inputMode="text"
              autoComplete="off"
              autoFocus
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="0712 345 678 or ACS-48217"
              className={input}
            />
            <p className="mt-1.5 text-xs text-ink-500">07…, 01…, 2547… or +2547… all work. Several family members may share one phone.</p>
          </div>
          {errorBox}
          <button type="submit" disabled={busy || !query.trim()} className={`${btn.gold} w-full`}>
            <Search size={17} aria-hidden /> {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}

      {step === 'pick' && lookup && (
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <p className="text-sm font-medium text-navy-900">
            {lookup.patients.length === 1 ? 'Found 1 patient' : `Found ${lookup.patients.length} patients`} on {lookup.phoneNumber ?? lookup.query}. Pick the
            right person.
          </p>
          <PatientMatchList
            patients={lookup.patients}
            action={(p) => (
              <button type="button" className={btn.gold} onClick={() => choose(p as WalkInPatientMatch)}>
                Select
              </button>
            )}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button type="button" onClick={startOver} className={btn.secondary}>
              Search again
            </button>
            {lookup.phoneNumber && (
              <button type="button" onClick={() => setStep('add')} className={btn.secondary}>
                <UserPlus size={16} aria-hidden /> Someone else on this phone
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'add' && lookup && (
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <UserPlus size={19} aria-hidden className="mt-0.5 flex-none" />
            <span>
              {lookup.patients.length === 0 ? `No patient found for ${lookup.phoneNumber ?? lookup.query}.` : 'Add a new person on this phone.'} Add them
              below, then continue to the queue.
            </span>
          </div>
          <AddPatientForm
            initialPhone={lookup.phoneNumber ?? undefined}
            submitLabel="Add and continue"
            skipRegistrationSms
            onCancel={startOver}
            onAdded={(r) =>
              choose(
                {
                  id: r.patient.id,
                  name: r.patient.name,
                  patientCode: r.patient.patientCode,
                  sex: 'UNKNOWN',
                  dateOfBirth: null,
                  birthYear: null,
                  dateOfBirthEstimated: false,
                  linkedToClinic: true,
                  lastVisitAt: null,
                  hasIdOnFile: false,
                  hasNextOfKinOnFile: false,
                  privacyNoticeAckRequired: false,
                },
                true,
              )
            }
            onPickExisting={(p) => {
              const match = lookup.patients.find((x) => x.id === p.id);
              choose(match ?? { ...p, hasIdOnFile: false, hasNextOfKinOnFile: false, privacyNoticeAckRequired: true });
            }}
          />
        </div>
      )}

      {step === 'details' && patient && (
        <form onSubmit={(e) => void handleCheckIn(e)} className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div className="flex gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <Avatar name={patient.name} size="lg" />
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-800">
                <UserRoundCheck size={14} aria-hidden /> {isNewPatient ? 'New patient added' : 'Patient selected'}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-navy-900">{patient.name}</p>
              <p className="text-sm text-ink-700">
                {patient.patientCode}
                {!isNewPatient && ` · ${describeBirth(patient)}`}
              </p>
              {!isNewPatient && <p className="mt-1 text-sm text-ink-500">{formatLastVisit(patient.lastVisitAt)}</p>}
            </div>
          </div>

          {!isNewPatient && (
            <label className="flex items-start gap-3 rounded-xl bg-cream-100 p-3.5 text-sm text-ink-700 ring-1 ring-slate-200">
              <input
                type="checkbox"
                required
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
              />
              <span>
                I asked the patient their <strong>full name</strong> and <strong>date of birth</strong>, and they match.
              </span>
            </label>
          )}

          <details className="group rounded-2xl border border-slate-200 bg-cream-50 px-4">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-sm font-semibold text-navy-900">
              <IdCard size={17} aria-hidden className="text-gold-700" />
              ID and next of kin <span className="font-normal text-ink-500">(optional)</span>
              <span className="ml-auto text-xs font-normal text-ink-500">
                {[patient.hasIdOnFile && 'ID on file', patient.hasNextOfKinOnFile && 'Next of kin on file'].filter(Boolean).join(' · ') || 'Nothing on file'}
              </span>
            </summary>
            <div className="pb-4">
              <p className="mb-3 text-sm text-ink-500">Fill in only what you want to add or update. Empty fields leave what&apos;s on file unchanged.</p>
              <IdentityFields idPrefix="walkin" value={identity} onChange={setIdentity} />
            </div>
          </details>

          <div>
            <label htmlFor="reason" className={label}>
              Reason for visit
            </label>
            <input
              id="reason"
              required
              minLength={2}
              maxLength={200}
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Review"
              className={input}
            />
          </div>

          <div>
            <label htmlFor="department" className={label}>
              Department
            </label>
            <select id="department" required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={input}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-2.5 rounded-2xl bg-cream-100 p-4">
            <legend className="sr-only">Privacy and SMS</legend>
            {privacyNoticeAckRequired && (
              <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  required
                  checked={privacyNoticeExplained}
                  onChange={(e) => setPrivacyNoticeExplained(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
                />
                <span className="flex items-start gap-2">
                  <FileText size={17} aria-hidden className="mt-0.5 flex-none text-gold-700" />
                  <span>
                    Patient has been told how their data is used and where to read the{' '}
                    <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-700 underline">
                      Privacy Notice
                    </a>{' '}
                    <span className="text-ink-500">(acisi.co.ke/privacy)</span>
                  </span>
                </span>
              </label>
            )}
            <p className="flex items-start gap-2 px-1 text-sm text-ink-700">
              <MessageSquareText size={17} aria-hidden className="mt-0.5 flex-none text-teal-700" />
              The patient gets an SMS with their place in the queue, and one when they&apos;re next.
            </p>
            <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
              <input type="checkbox" checked={smsOptOut} onChange={(e) => setSmsOptOut(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900" />
              <span className="flex items-start gap-2">
                <MessageSquareOff size={17} aria-hidden className="mt-0.5 flex-none text-red-700" />
                Patient does not want any SMS
              </span>
            </label>
          </fieldset>

          {errorBox}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button type="button" onClick={startOver} disabled={busy} className={btn.secondary}>
              Not them — search again
            </button>
            <button
              type="submit"
              disabled={busy || !departmentId || !identityConfirmed || !legalBoxSatisfied(privacyNoticeAckRequired, privacyNoticeExplained)}
              className={btn.gold}
            >
              {busy ? 'Adding to queue…' : 'Add to queue'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && result && (
        <div className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div role="status" className="flex flex-col items-center rounded-2xl bg-emerald-50 px-4 py-6 text-center text-emerald-900">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
              <CircleCheckBig size={28} aria-hidden />
            </span>
            <p className="font-display text-lg font-semibold">
              {result.patientName} added to the queue, position {result.queuePosition}.
            </p>
            <p className="mt-1 text-sm">
              {result.departmentName} · {result.patientCode}
              {result.isNewPatient && ' · New patient'}
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-gold-500/40 bg-gold-tint/40 p-4 text-sm text-navy-900">
            <House size={20} aria-hidden className="mt-0.5 flex-none text-gold-700" />
            <p>
              <strong>Tell the patient:</strong> next time they can check in from home at <strong>acisi.co.ke</strong> and skip the wait. Their ACISI ID is{' '}
              <strong className="font-mono">{result.patientCode}</strong> — they should keep it safe.
            </p>
          </div>
          {result.sms === 'sent' && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-500">
              <MessageSquareText size={16} aria-hidden className="text-teal-700" /> Queue SMS sent.
            </p>
          )}
          {result.sms === 'failed' && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              The check-in worked, but the queue SMS couldn&apos;t be sent.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={startOver} className={`${btn.gold} flex-1`}>
              Check in another walk-in
            </button>
            <Link to="/queue" className={`${btn.secondary} flex-1`}>
              Back to queue
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
