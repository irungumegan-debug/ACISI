import { FormEvent, useEffect, useState } from 'react';
import { usePortalAuth } from '../context/PortalAuthContext';
import { api, Visit } from '../lib/api';

export function RecordsPage() {
  const { phoneNumber, loading, requestOtp, verifyOtp, logout } = usePortalAuth();

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!phoneNumber) {
    return <RecordsLogin requestOtp={requestOtp} verifyOtp={verifyOtp} />;
  }

  return <VisitsList phoneNumber={phoneNumber} onLogout={logout} />;
}

interface RecordsLoginProps {
  requestOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, code: string) => Promise<void>;
}

function RecordsLogin({ requestOtp, verifyOtp }: RecordsLoginProps) {
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequestOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestOtp(phoneNumber);
      setPhase('code');
    } catch {
      setError('Could not send a code. Check the number and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp(phoneNumber, code);
    } catch {
      setError('Incorrect or expired code.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-lg font-semibold text-navy-900">My records</h1>
      <p className="mb-6 text-sm text-slate-600">
        We&apos;ll text you a one-time code to confirm it&apos;s you — no password needed.
      </p>

      {phase === 'phone' ? (
        <form onSubmit={(e) => void handleRequestOtp(e)} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Your phone number</span>
            <input
              className="input"
              type="tel"
              placeholder="07XX XXX XXX"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleVerify(e)} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Enter the 6-digit code sent to {phoneNumber}</span>
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => setPhase('phone')}
            className="w-full text-sm text-slate-500 hover:underline"
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<Visit['status'], string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
  DONE: 'Completed',
};

function VisitsList({ phoneNumber, onLogout }: { phoneNumber: string; onLogout: () => Promise<void> }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);

  useEffect(() => {
    api
      .getVisits()
      .then((res) => setVisits(res.visits))
      .catch(() => setVisits([]));
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-navy-900">My records</h1>
          <p className="text-sm text-slate-500">{phoneNumber}</p>
        </div>
        <button onClick={() => void onLogout()} className="text-sm text-slate-500 hover:text-navy-700">
          Log out
        </button>
      </div>

      {visits === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : visits.length === 0 ? (
        <p className="text-sm text-slate-500">No visits on record yet.</p>
      ) : (
        <ul className="space-y-3">
          {visits.map((v) => (
            <li key={v.encounterId} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {new Date(v.visitedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span className="rounded-full bg-navy-100 px-3 py-1 text-xs text-navy-700">{v.departmentName}</span>
              </div>
              <p className="text-sm text-slate-500">
                {v.clinicName} · {STATUS_LABEL[v.status]}
              </p>
              {v.prescription && (
                <p className="mt-2 text-sm text-navy-900">
                  <span className="font-medium">Prescription:</span> {v.prescription}
                </p>
              )}
              {v.notes && (
                <p className="mt-1 text-sm text-navy-900">
                  <span className="font-medium">Notes:</span> {v.notes}
                </p>
              )}
              {!v.prescription && !v.notes && v.status !== 'DONE' && (
                <p className="mt-2 text-sm text-slate-400">Visit in progress — details will appear after checkout.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
