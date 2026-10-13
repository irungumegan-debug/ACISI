import { FormEvent, useState } from 'react';
import { KeyRound, Lock, MessageSquareText } from 'lucide-react';
import { api, ApiError, RecordAccessStatus } from '../lib/api';
import { btn, field } from './ui';

/**
 * Shown when a patient has records at other ACISI clinics that this clinic
 * can't see. The patient approves by reading out a code we text them, or
 * by typing their own ACISI PIN here. Doctors only see the explanation —
 * asking is a front-desk job, done with the patient present.
 */
export function RequestPastRecords({
  patientId,
  status,
  canRequest,
  onApproved,
}: {
  patientId: string;
  status: RecordAccessStatus | null;
  canRequest: boolean;
  onApproved: () => void;
}) {
  const [codeSentUntil, setCodeSentUntil] = useState<string | null>(status?.pendingUntil ?? null);
  const [mode, setMode] = useState<'code' | 'pin'>(status?.smsOptOut ? 'pin' : 'code');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestPastRecords(patientId);
      setCodeSentUntil(res.expiresAt);
      setMode('code');
      setValue('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.approvePastRecords(patientId, mode === 'code' ? { code: value } : { pin: value });
      onApproved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl bg-cream-100 px-3.5 py-3 text-sm text-ink-700">
      <p className="flex items-start gap-2">
        <Lock size={15} aria-hidden className="mt-0.5 flex-none" />
        This patient has records at other ACISI clinics. They stay hidden until the patient agrees to share them with your clinic.
      </p>
      {!canRequest && <p className="mt-2 text-ink-500">Ask the front desk to request past records with the patient present.</p>}
      {canRequest && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} disabled={busy || status?.smsOptOut} onClick={() => void sendCode()}>
              <MessageSquareText size={16} aria-hidden /> {codeSentUntil ? 'Send a new code' : 'Request past records'}
            </button>
            {status?.patientHasPin && (
              <button
                type="button"
                className={btn.secondary}
                disabled={busy}
                onClick={() => {
                  setMode('pin');
                  setValue('');
                }}
              >
                <KeyRound size={16} aria-hidden /> Patient types their PIN instead
              </button>
            )}
          </div>
          {status?.smsOptOut && <p className="text-xs text-ink-500">This patient doesn&apos;t receive SMS, so only their PIN can approve.</p>}
          {(mode === 'pin' || codeSentUntil) && (
            <form onSubmit={(e) => void approve(e)} className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1">
                <span className={field.label}>
                  {mode === 'code' ? 'Code the patient reads out (sent by SMS, valid 10 minutes)' : 'Patient types their 6-digit ACISI PIN'}
                </span>
                <input
                  type={mode === 'pin' ? 'password' : 'text'}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={field.input}
                />
              </label>
              <button type="submit" disabled={busy || value.length !== 6} className={btn.gold}>
                {busy ? 'Checking…' : 'Approve'}
              </button>
            </form>
          )}
          {mode === 'pin' && <p className="text-xs text-ink-500">Turn the screen to the patient. Staff should not see or type the PIN.</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
