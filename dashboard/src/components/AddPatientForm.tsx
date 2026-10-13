import { FormEvent, useState } from 'react';
import { FileText, MessageSquareOff, ShieldCheck, UsersRound } from 'lucide-react';
import { AddPatientResult, api, ApiError, PatientMatch } from '../lib/api';
import { PRIVACY_PATH } from '../lib/legal';
import { btn, field } from './ui';
import { PatientMatchList } from './PatientMatchList';

const { label, input } = field;

interface Props {
  /** Pre-filled (and locked) phone, e.g. from a walk-in search that found nobody. */
  initialPhone?: string;
  submitLabel?: string;
  /** Walk-in: the walk-in flow sends its own queue SMS, so no registration SMS here. */
  skipRegistrationSms?: boolean;
  onAdded: (result: AddPatientResult) => void;
  /** Staff picked an existing patient instead of adding a new one. */
  onPickExisting: (patient: PatientMatch) => void;
  onCancel?: () => void;
}

/**
 * "Add patient": full name, phone, date of birth, sex. The server checks the
 * phone number first; if others are already registered on it, they're
 * shown here and staff either pick one or confirm this is someone new (e.g.
 * a child on a parent's phone).
 */
export function AddPatientForm({ initialPhone, submitLabel = 'Add patient', skipRegistrationSms, onAdded, onPickExisting, onCancel }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [privacyNoticeExplained, setPrivacyNoticeExplained] = useState(false);
  const [smsOptOut, setSmsOptOut] = useState(false);
  const [existing, setExisting] = useState<{ patients: PatientMatch[]; duplicate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(confirmedNewPersonOnPhone: boolean): Promise<void> {
    if (busy || !sex) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.addPatient({
        fullName,
        phone,
        dateOfBirth,
        sex,
        registrationConsent,
        privacyNoticeExplained,
        smsOptOut,
        confirmedNewPersonOnPhone,
        skipRegistrationSms: Boolean(skipRegistrationSms),
      });
      onAdded(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.body.existing)) {
        setExisting({ patients: err.body.existing as PatientMatch[], duplicate: err.body.reason === 'duplicate' });
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void submit(false);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ap-name" className={label}>
          Full name
        </label>
        <input
          id="ap-name"
          required
          minLength={3}
          maxLength={100}
          autoComplete="off"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Jane Wanjiru"
          className={input}
        />
      </div>
      <div>
        <label htmlFor="ap-phone" className={label}>
          Phone number
        </label>
        <input
          id="ap-phone"
          required
          type="tel"
          inputMode="tel"
          autoComplete="off"
          readOnly={Boolean(initialPhone)}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setExisting(null);
          }}
          placeholder="07XX XXX XXX"
          className={`${input} ${initialPhone ? 'bg-cream-100 text-ink-500' : ''}`}
        />
        <p className="mt-1 text-xs text-ink-500">Several family members can share one phone number. Each gets their own ACISI ID.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ap-dob" className={label}>
            Date of birth
          </label>
          <input id="ap-dob" required type="date" max={today} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="ap-sex" className={label}>
            Sex
          </label>
          <select id="ap-sex" required value={sex} onChange={(e) => setSex(e.target.value as typeof sex)} className={input}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-2.5 rounded-2xl bg-cream-100 p-4">
        <legend className="sr-only">Consent, privacy and SMS</legend>
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
            Patient agreed to ACISI keeping a record for them (required).
          </span>
        </label>
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
        <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-ink-700 ring-1 ring-slate-200">
          <input type="checkbox" checked={smsOptOut} onChange={(e) => setSmsOptOut(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900" />
          <span className="flex items-start gap-2">
            <MessageSquareOff size={17} aria-hidden className="mt-0.5 flex-none text-red-700" />
            Patient does not want any SMS
          </span>
        </label>
      </fieldset>

      {existing && existing.patients.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
            <UsersRound size={18} aria-hidden className="mt-0.5 flex-none" />
            {existing.duplicate
              ? 'This person is already registered. Pick them below instead of adding them again.'
              : 'Already registered on this phone number. Is the patient one of these people?'}
          </p>
          <PatientMatchList
            patients={existing.patients}
            action={(p) => (
              <button type="button" className={btn.secondary} onClick={() => onPickExisting(p)}>
                This is them
              </button>
            )}
          />
          {!existing.duplicate && (
            <button type="button" disabled={busy} className={`${btn.primary} w-full`} onClick={() => void submit(true)}>
              No — add {fullName.trim() || 'them'} as a new person on this phone
            </button>
          )}
        </div>
      )}

      {error && !existing && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={busy} className={btn.secondary}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="submit" disabled={busy || !registrationConsent || !privacyNoticeExplained || !sex || Boolean(existing)} className={btn.gold}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
