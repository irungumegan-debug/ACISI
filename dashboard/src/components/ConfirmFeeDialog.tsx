import { FormEvent, useEffect, useRef, useState } from 'react';
import { ReceiptText, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { btn, field } from './ui';

/** Same shape the server accepts: 10 letters and numbers, with both. */
function looksLikeMpesaCode(raw: string): boolean {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(code) && /[A-Z]/.test(code) && /[0-9]/.test(code);
}

/**
 * Front desk's manual confirmation of the ACISI check-in fee, for when the
 * M-Pesa prompt went through on the patient's phone but ACISI never heard
 * back. Asks for the transaction code from the patient's M-Pesa SMS; the
 * server stores it with who confirmed and when, and refuses a code that was
 * already used.
 */
export function ConfirmFeeDialog({
  checkInId,
  patientName,
  amountKes,
  onClose,
  onConfirmed,
}: {
  checkInId: string;
  patientName: string;
  amountKes: number;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape closes; focus moves to the code field and returns to the page on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!looksLikeMpesaCode(code) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.confirmCheckInPaid(checkInId, code);
      onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm the payment. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-navy-950/60" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-fee-title"
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-raised outline-none sm:max-w-md sm:rounded-3xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="confirm-fee-title" className="flex items-center gap-2 font-display text-xl font-semibold text-navy-900">
              <ReceiptText size={20} aria-hidden className="text-gold-700" /> Confirm check-in fee
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              For {patientName}, KES {amountKes}. Ask to see the M-Pesa SMS for this payment.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-ink-500 hover:bg-slate-100">
            <X size={20} aria-hidden />
          </button>
        </div>

        <form onSubmit={(e) => void save(e)}>
          <label htmlFor="confirm-fee-code" className={field.label}>
            M-Pesa transaction code
          </label>
          <input
            ref={inputRef}
            id="confirm-fee-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. QAB12CD34E"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={14}
            className={`${field.input} font-mono tracking-wider`}
          />
          <p className="mt-1.5 text-xs text-ink-500">10 letters and numbers, at the start of the SMS. Your name and the time are recorded.</p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={btn.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={!looksLikeMpesaCode(code) || saving} className={btn.gold}>
              {saving ? 'Confirming…' : 'Confirm payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
