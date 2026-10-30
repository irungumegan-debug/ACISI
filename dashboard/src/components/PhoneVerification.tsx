import { FormEvent, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { btn, Card, field } from './ui';

/**
 * "The phone rang in front of me": the check that replaces the SMS code
 * when SMS can't be sent. Front desk rings the patient's number from the
 * clinic phone; if the patient's phone rings, they hold the number.
 */
function RingConfirmation({ phoneNumber, confirmed, onChange }: { phoneNumber: string; confirmed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mt-3 rounded-xl bg-cream-100 p-3 text-sm text-ink-700">
      <p>
        1. Ring{' '}
        <a href={`tel:${phoneNumber}`} className="font-semibold text-gold-700 underline">
          {phoneNumber}
        </a>{' '}
        from the clinic phone while the patient is in front of you.
      </p>
      <label className="mt-2 flex items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 accent-navy-900" />
        <span>2. The patient&apos;s phone rang in front of me.</span>
      </label>
    </div>
  );
}

/** Patients page: finish a web signup whose SMS code could not be sent. */
export function FinishWebSignup() {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<{ phoneNumber: string; signups: { pendingId: string; name: string; signedUpAt: string }[] } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    setConfirmed(false);
    try {
      setFound(await api.findPendingSignups(phone));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not look that up.');
    } finally {
      setBusy(false);
    }
  }

  async function finish(pendingId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.completePendingSignup(pendingId);
      setDone(res.patientCode);
      setFound(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not finish the signup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Finish a patient's web signup" icon={PhoneCall}>
      <p className="text-sm text-ink-500">
        For a patient who signed up on the website but never got their SMS code. Their details are saved for 14 days.
      </p>
      <form onSubmit={(e) => void lookup(e)} className="mt-3 flex gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Patient's phone number" className={field.input} />
        <button type="submit" className={btn.secondary} disabled={busy || !phone.trim()}>
          Find
        </button>
      </form>
      {found && found.signups.length === 0 && <p className="mt-3 text-sm text-ink-500">No waiting signup for that number.</p>}
      {found &&
        found.signups.map((s) => (
          <div key={s.pendingId} className="mt-3">
            <p className="text-sm">
              Waiting signup: <strong>{s.name}</strong>. Check this is the patient in front of you.
            </p>
            <RingConfirmation phoneNumber={found.phoneNumber} confirmed={confirmed} onChange={setConfirmed} />
            <button type="button" className={`${btn.gold} mt-3`} disabled={busy || !confirmed} onClick={() => void finish(s.pendingId)}>
              Finish setup
            </button>
          </div>
        ))}
      {done && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          Account created ({done}). The patient can now log in at acisi.co.ke with their phone number and the PIN they chose.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}

/** Patient page: a one-time setup code for a patient who wants portal access but can't get the SMS. */
export function PortalSetupCode({ patientId, phoneNumber }: { patientId: string; phoneNumber: string }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue(): Promise<void> {
    setError(null);
    try {
      setCode(await api.issueSetupCode(patientId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a code.');
    }
  }

  return (
    <Card title="Patient portal access" icon={PhoneCall}>
      {!open ? (
        <>
          <p className="text-sm text-ink-500">If the patient can&apos;t get the SMS code to set their portal PIN, you can confirm their phone here.</p>
          <button type="button" className={`${btn.secondary} mt-3`} onClick={() => setOpen(true)}>
            Set up portal access in person
          </button>
        </>
      ) : code ? (
        <div role="status">
          <p className="text-sm">Give the patient this code. On acisi.co.ke they choose Log in → Forgot PIN, enter their phone number, then this code and a new PIN.</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-navy-900">{code.code}</p>
          <p className="text-xs text-ink-500">Valid until {new Date(code.expiresAt).toLocaleTimeString()}. Works once.</p>
        </div>
      ) : (
        <>
          <RingConfirmation phoneNumber={phoneNumber} confirmed={confirmed} onChange={setConfirmed} />
          <button type="button" className={`${btn.gold} mt-3`} disabled={!confirmed} onClick={() => void issue()}>
            Show setup code
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}
