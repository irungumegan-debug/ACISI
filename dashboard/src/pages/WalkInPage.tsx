import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError, DepartmentOption, Sex, WalkInLookup, WalkInResult } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Check, CircleCheckBig, MessageSquareOff, MessageSquareText, Search, ShieldCheck, UserPlus, UserRoundCheck } from 'lucide-react';
import { Avatar, btn, field } from '../components/ui';

const input = `${field.input} text-base sm:text-[15px]`;
const label = field.label;

const STEPS: { key: Step; label: string }[] = [
  { key: 'search', label: 'Find patient' },
  { key: 'details', label: 'Visit details' },
  { key: 'done', label: 'In the queue' },
];

function StepIndicator({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.key === step);
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

type Step = 'search' | 'details' | 'done';

/**
 * Front-desk check-in for a patient who walked in without checking in
 * remotely: find them by phone (or register them), then add them to the
 * same queue as everyone else. No ACISI fee, no payment prompt.
 */
export function WalkInPage() {
  const { session } = useAuth();
  const [step, setStep] = useState<Step>('search');
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<WalkInLookup | null>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const [fullName, setFullName] = useState('');
  const [ageMode, setAgeMode] = useState<'age' | 'dob'>('age');
  const [age, setAge] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<Sex | ''>('');
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [smsOptOut, setSmsOptOut] = useState(false);
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

  const isNewPatient = lookup !== null && lookup.patient === null;

  function startOver(): void {
    setStep('search');
    setPhone('');
    setLookup(null);
    setReason('');
    setFullName('');
    setAge('');
    setDateOfBirth('');
    setSex('');
    setRegistrationConsent(false);
    setSmsConsent(false);
    setSmsOptOut(false);
    setError(null);
    setResult(null);
  }

  async function handleSearch(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await api.lookupWalkIn(phone);
      setLookup(found);
      setPhone(found.phoneNumber);
      setStep('details');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || !lookup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.checkInWalkIn({
        phone: lookup.phoneNumber,
        departmentId,
        reasonForVisit: reason,
        smsConsent,
        smsOptOut,
        newPatient: isNewPatient
          ? {
              fullName,
              registrationConsent,
              sex: sex || undefined,
              ...(ageMode === 'age' && age.trim() ? { age: Number(age) } : {}),
              ...(ageMode === 'dob' && dateOfBirth ? { dateOfBirth } : {}),
            }
          : undefined,
      });
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

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
            <label htmlFor="phone" className={label}>
              Patient&apos;s phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              className={input}
            />
            <p className="mt-1.5 text-xs text-ink-500">07…, 01…, 2547… or +2547… all work.</p>
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !phone.trim()} className={`${btn.gold} w-full`}>
            <Search size={17} aria-hidden /> {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}

      {step === 'details' && lookup && (
        <form onSubmit={(e) => void handleCheckIn(e)} className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          {lookup.patient ? (
            <div className="flex gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <Avatar name={lookup.patient.name} size="lg" />
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-800">
                  <UserRoundCheck size={14} aria-hidden /> Patient found
                </p>
                <p className="mt-1 font-display text-lg font-semibold text-navy-900">{lookup.patient.name}</p>
                <p className="text-sm text-ink-700">
                  {lookup.patient.patientCode} · {lookup.phoneNumber}
                </p>
                <p className="mt-1 text-sm text-ink-500">{formatLastVisit(lookup.patient.lastVisitAt)}</p>
                <p className="mt-2 text-sm font-medium text-navy-900">Check this is the right person before continuing.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <UserPlus size={19} aria-hidden className="mt-0.5 flex-none" />
                <span>No patient with {lookup.phoneNumber}. Register them below.</span>
              </div>
              <div>
                <label htmlFor="fullName" className={label}>
                  Full name
                </label>
                <input
                  id="fullName"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="off"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Lisa Jane"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="newPhone" className={label}>
                  Phone number
                </label>
                <input id="newPhone" value={lookup.phoneNumber} readOnly className={`${input} bg-cream-100 text-ink-500`} />
              </div>
              <div>
                <span className={label}>
                  Age or date of birth <span className="font-normal text-ink-500">(optional)</span>
                </span>
                <div className="mb-2 inline-flex rounded-full border border-slate-300 bg-cream-50 p-1 text-sm">
                  {(['age', 'dob'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAgeMode(mode)}
                      aria-pressed={ageMode === mode}
                      className={`min-h-9 rounded-full px-4 py-1 font-medium ${ageMode === mode ? 'bg-navy-900 text-white' : 'text-ink-500'}`}
                    >
                      {mode === 'age' ? 'Age' : 'Date of birth'}
                    </button>
                  ))}
                </div>
                {ageMode === 'age' ? (
                  <input
                    aria-label="Age in years"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Years"
                    className={input}
                  />
                ) : (
                  <input
                    aria-label="Date of birth"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className={input}
                  />
                )}
              </div>
              <div>
                <label htmlFor="sex" className={label}>
                  Gender <span className="font-normal text-ink-500">(optional)</span>
                </label>
                <select id="sex" value={sex} onChange={(e) => setSex(e.target.value as Sex | '')} className={input}>
                  <option value="">Prefer not to say</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
          )}

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
              placeholder="e.g. Fever and headache"
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
            <legend className="sr-only">Consent and SMS</legend>
            {isNewPatient && (
              <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  required
                  checked={registrationConsent}
                  onChange={(e) => setRegistrationConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
                />
                <span className="flex items-start gap-2">
                  <ShieldCheck size={17} aria-hidden className="mt-0.5 flex-none text-gold-700" />
                  Patient agreed to ACISI creating a health record for them (required to register).
                </span>
              </label>
            )}
            <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
              <input
                type="checkbox"
                checked={smsConsent}
                disabled={smsOptOut}
                onChange={(e) => setSmsConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
              />
              <span className={`flex items-start gap-2 ${smsOptOut ? 'text-slate-400' : ''}`}>
                <MessageSquareText size={17} aria-hidden className="mt-0.5 flex-none text-teal-700" />
                Patient agreed to receive SMS from the clinic
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
              <input
                type="checkbox"
                checked={smsOptOut}
                onChange={(e) => {
                  setSmsOptOut(e.target.checked);
                  if (e.target.checked) setSmsConsent(false);
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
              />
              <span className="flex items-start gap-2">
                <MessageSquareOff size={17} aria-hidden className="mt-0.5 flex-none text-red-700" />
                Patient does not want any SMS (no payment receipts or visit summaries)
              </span>
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              className={btn.secondary}
            >
              {lookup.patient ? 'Not them — search again' : 'Search again'}
            </button>
            <button
              type="submit"
              disabled={busy || !departmentId || (isNewPatient && !registrationConsent)}
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
              {result.isNewPatient && ' · New patient registered'}
            </p>
          </div>
          {result.sms === 'sent' && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-500">
              <MessageSquareText size={16} aria-hidden className="text-teal-700" /> Invite SMS sent.
            </p>
          )}
          {result.sms === 'failed' && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              The check-in worked, but the invite SMS couldn&apos;t be sent. Their SMS consent has been saved.
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
