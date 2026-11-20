import { FormEvent, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { btn, Card, field } from './ui';

/** Settings: the Sub-County Disease Surveillance Coordinator's email, for emailed MOH 505 summaries and immediate notices. */
export function SurveillanceEmailSection() {
  const [state, setState] = useState<{ email: string | null; lastWeekSent?: string | null; emailAvailable: boolean } | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSurveillanceEmail()
      .then((s) => {
        setState(s);
        setValue(s.email ?? '');
      })
      .catch(() => setState(null));
  }, []);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const s = await api.setSurveillanceEmail(value.trim() || null);
      setState({ ...state!, ...s });
      setMessage(s.email ? 'Saved. Reports will be emailed to this address.' : 'Removed. Reports are no longer emailed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <Card title="Disease surveillance reporting" icon={ShieldAlert}>
      <p className="mb-3 text-sm text-ink-700">
        The email of your Sub-County Disease Surveillance Coordinator (SCDSC). ACISI then emails them the weekly MOH 505 summary every Monday morning, and an
        immediate notice for each immediately reportable disease or public health event. Counts and disease names only: never patient names or details (they
        call the clinic for those). Still phone them for immediate cases, as the guidelines say.
      </p>
      {!state.emailAvailable && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">Email sending isn&apos;t set up on the ACISI server yet, so nothing is sent until it is.</p>
      )}
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="scdscEmail" className={field.label}>
            Coordinator&apos;s email
          </label>
          <input id="scdscEmail" type="email" className={field.input} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. scdsc.langata@example.go.ke" maxLength={200} />
        </div>
        <button type="submit" className={btn.primary} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
      {state.lastWeekSent && <p className="mt-2 text-xs text-ink-500">Last weekly summary sent: week of {state.lastWeekSent}.</p>}
      {message && <p className="mt-2 text-sm text-emerald-700" role="status">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </Card>
  );
}
