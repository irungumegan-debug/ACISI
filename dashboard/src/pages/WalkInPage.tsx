import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError, DepartmentOption, Sex, WalkInLookup, WalkInResult } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const input =
  'w-full rounded-md border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none';
const label = 'mb-1 block text-sm font-medium text-slate-700';

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
    <div className="mx-auto max-w-lg">
      <p className="mb-2 text-sm">
        <Link to="/queue" className="text-slate-500 hover:text-slate-900">
          ← Back to queue
        </Link>
      </p>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Check in walk-in patient</h1>
      <p className="mb-5 text-sm text-slate-500">For patients who arrived without checking in remotely. No ACISI check-in fee is charged.</p>

      {step === 'search' && (
        <form onSubmit={(e) => void handleSearch(e)} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
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
            <p className="mt-1 text-xs text-slate-500">07…, 01…, 2547… or +2547… all work.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}

      {step === 'details' && lookup && (
        <form onSubmit={(e) => void handleCheckIn(e)} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
          {lookup.patient ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Patient found</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{lookup.patient.name}</p>
              <p className="text-sm text-slate-600">
                {lookup.patient.patientCode} · {lookup.phoneNumber}
              </p>
              <p className="mt-1 text-sm text-slate-600">{formatLastVisit(lookup.patient.lastVisitAt)}</p>
              <p className="mt-3 text-sm text-slate-700">Check this is the right person before continuing.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No patient with {lookup.phoneNumber}. Register them below.
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
                  placeholder="e.g. Jane Wanjiru"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="newPhone" className={label}>
                  Phone number
                </label>
                <input id="newPhone" value={lookup.phoneNumber} readOnly className={`${input} bg-slate-50 text-slate-600`} />
              </div>
              <div>
                <span className={label}>
                  Age or date of birth <span className="font-normal text-slate-500">(optional)</span>
                </span>
                <div className="mb-2 inline-flex rounded-md border border-slate-300 p-0.5 text-sm">
                  {(['age', 'dob'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAgeMode(mode)}
                      className={`rounded px-3 py-1 ${ageMode === mode ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
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
                  Gender <span className="font-normal text-slate-500">(optional)</span>
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

          <div className="space-y-3">
            {isNewPatient && (
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  required
                  checked={registrationConsent}
                  onChange={(e) => setRegistrationConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>Patient agreed to ACISI creating a health record for them (required to register).</span>
              </label>
            )}
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={smsConsent}
                disabled={smsOptOut}
                onChange={(e) => setSmsConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span className={smsOptOut ? 'text-slate-400' : ''}>Patient agreed to receive SMS from the clinic</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={smsOptOut}
                onChange={(e) => {
                  setSmsOptOut(e.target.checked);
                  if (e.target.checked) setSmsConsent(false);
                }}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>Patient does not want any SMS (no payment receipts or visit summaries)</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
            >
              {lookup.patient ? 'Not them — search again' : 'Search again'}
            </button>
            <button
              type="submit"
              disabled={busy || !departmentId || (isNewPatient && !registrationConsent)}
              className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? 'Adding to queue…' : 'Add to queue'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && result && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <p className="font-semibold">
              {result.patientName} added to the queue, position {result.queuePosition}.
            </p>
            <p className="mt-1 text-sm">
              {result.departmentName} · {result.patientCode}
              {result.isNewPatient && ' · New patient registered'}
            </p>
          </div>
          {result.sms === 'sent' && <p className="text-sm text-slate-600">Invite SMS sent.</p>}
          {result.sms === 'failed' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              The check-in worked, but the invite SMS couldn&apos;t be sent. Their SMS consent has been saved.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={startOver}
              className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Check in another walk-in
            </button>
            <Link
              to="/queue"
              className="rounded-md border border-slate-300 px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:border-slate-500"
            >
              Back to queue
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
