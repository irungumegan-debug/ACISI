import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { api, Clinic, Department } from '../lib/api';

type Step = 'form' | 'register' | 'paying' | 'done' | 'failed';

const SEX_OPTIONS: Array<{ value: 'MALE' | 'FEMALE' | 'OTHER'; label: string }> = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other / prefer not to say' },
];

/** How often to poll for the M-Pesa result — the STK push is async, same as the USSD flow. */
const STATUS_POLL_INTERVAL_MS = 3000;

export function CheckInPage() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [feeKes, setFeeKes] = useState<number | null>(null);
  const [clinicId, setClinicId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const clientRequestIdRef = useRef(crypto.randomUUID());

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    api
      .getClinics()
      .then((res) => setClinics(res.clinics))
      .catch(() => setClinics([]));
    api
      .getDepartments()
      .then((res) => setDepartments(res.departments))
      .catch(() => setDepartments([]));
    api
      .getFee()
      .then((res) => setFeeKes(res.checkInFeeKes))
      .catch(() => setFeeKes(null));
  }, []);

  useEffect(() => {
    if (step !== 'paying' || !checkInId) return;

    let cancelled = false;
    const interval = setInterval(() => {
      void api
        .getCheckinStatus(checkInId)
        .then((res) => {
          if (cancelled) return;
          if (res.status === 'PAID') {
            setQueuePosition(res.queuePosition);
            setStep('done');
          } else if (res.status === 'FAILED' || res.status === 'CANCELLED') {
            setError('Payment was not completed. Please try again.');
            setStep('failed');
          }
        })
        .catch(() => {
          // transient network blip — keep polling, the next tick will retry
        });
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, checkInId]);

  async function submitCheckin(withRegistration: boolean): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.checkin({
        clinicId,
        departmentId,
        phoneNumber,
        clientRequestId: clientRequestIdRef.current,
        registration: withRegistration
          ? { firstName, lastName, birthYear: Number(birthYear), sex, consent: true }
          : undefined,
      });

      if (res.status === 'REGISTRATION_REQUIRED') {
        setStep('register');
        return;
      }

      setCheckInId(res.checkInId);
      setStep('paying');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(e: FormEvent): void {
    e.preventDefault();
    void submitCheckin(false);
  }

  function handleRegisterSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!consent) {
      setError('Please agree to continue.');
      return;
    }
    void submitCheckin(true);
  }

  function resetToForm(): void {
    clientRequestIdRef.current = crypto.randomUUID();
    setCheckInId(null);
    setError(null);
    setStep('form');
  }

  const selectedClinicName = clinics.find((c) => c.id === clinicId)?.name ?? '';
  const selectedDepartmentName = departments.find((d) => d.id === departmentId)?.name ?? '';
  const feeLabel = feeKes !== null ? `KES ${feeKes}` : '';

  if (step === 'paying') {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-navy-200 border-t-navy-700" />
        <h1 className="text-lg font-semibold text-navy-900">Check your phone</h1>
        <p className="mt-2 text-sm text-slate-600">
          We&apos;ve sent an M-Pesa prompt to {phoneNumber}. Enter your M-Pesa PIN to complete check-in at{' '}
          {selectedClinicName}.
        </p>
      </div>
    );
  }

  if (step === 'failed') {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <h1 className="text-lg font-semibold text-navy-900">Check-in wasn&apos;t completed</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <button onClick={resetToForm} className="btn-primary mt-6">
          Try again
        </button>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-700 text-2xl text-white">
          ✓
        </div>
        <h1 className="text-lg font-semibold text-navy-900">You&apos;re checked in</h1>
        <p className="mt-1 text-sm text-slate-600">
          {selectedDepartmentName} — {selectedClinicName}
        </p>
        {queuePosition !== null && (
          <>
            <p className="mt-6 text-4xl font-semibold text-navy-900">#{queuePosition}</p>
            <p className="text-sm text-slate-500">your position in the queue</p>
          </>
        )}
        <p className="mt-6 text-sm text-slate-500">
          We&apos;ll text you a summary and your prescription the moment you&apos;re checked out.
        </p>
      </div>
    );
  }

  if (step === 'register') {
    return (
      <form onSubmit={handleRegisterSubmit} className="mx-auto max-w-md space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-navy-900">A few details first</h1>
          <p className="mt-1 text-sm text-slate-600">
            We don&apos;t have a record for {phoneNumber} yet — this only takes a moment.
          </p>
        </div>

        <Field label="First name">
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </Field>
        <Field label="Last name">
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </Field>
        <Field label="Year of birth">
          <input
            className="input"
            inputMode="numeric"
            placeholder="e.g. 1990"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            required
          />
        </Field>
        <Field label="Sex">
          <select className="input" value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>
            ACISI keeps a basic health record shared across clinics you check into, so any clinic can see your
            history. We only use it for your care. I agree.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Please wait…' : `Confirm check-in${feeLabel ? ` — pay ${feeLabel}` : ''}`}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-navy-900">Check in to a clinic</h1>
        <p className="mt-1 text-sm text-slate-600">
          Select where you&apos;re headed and what you need — this is the same flow as our USSD check-in, on your
          phone&apos;s browser.
        </p>
      </div>

      <Field label="Clinic">
        <select className="input" value={clinicId} onChange={(e) => setClinicId(e.target.value)} required>
          <option value="" disabled>
            Select a clinic
          </option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="What do you need today?">
        <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
          <option value="" disabled>
            Select a department
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Your phone number">
        <input
          className="input"
          type="tel"
          placeholder="07XX XXX XXX"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          required
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !clinicId || !departmentId || !phoneNumber}
        className="btn-primary w-full"
      >
        {submitting ? 'Please wait…' : `Confirm check-in${feeLabel ? ` — pay ${feeLabel}` : ''}`}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}
