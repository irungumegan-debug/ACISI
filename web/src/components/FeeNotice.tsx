import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api, ApiError, FeeStatus } from '../lib/api';

function kes(n: number): string {
  return n.toLocaleString('en-KE');
}

/**
 * Unpaid ACISI check-in fee (C20): a notice with a Pay button. From day 7 it
 * reads as a reminder; once the account is restricted it says what is
 * blocked. Paying lifts a restriction straight away.
 */
export function FeeNotice() {
  const [status, setStatus] = useState<FeeStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .getFees()
      .then(setStatus)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  if (!status || status.owedKes <= 0) return null;

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.payFees();
      setMessage(`We sent an M-Pesa prompt for KSh ${kes(res.amountKes)} to your phone. Enter your M-Pesa PIN to pay.`);
      window.setTimeout(() => void load(), 30_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" role={status.restricted ? 'alert' : 'status'}>
      <h2>
        <Wallet size={18} aria-hidden /> {status.reminder ? 'Reminder: ' : ''}You have an unpaid ACISI check-in fee of KSh {kes(status.owedKes)}
      </h2>
      {status.restricted ? (
        <p>
          {status.restrictionMessage} Until then you can&apos;t check in from home or book appointments. You can still log in,
          see and download your records, and be seen at the clinic as a walk-in.
        </p>
      ) : (
        <p>You can pay it now. Your next check-in from home will otherwise ask for it together with the new fee.</p>
      )}
      {message ? (
        <p role="status">{message}</p>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void pay()}>
          {busy ? 'Sending…' : `Pay KSh ${kes(status.owedKes)}`}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
