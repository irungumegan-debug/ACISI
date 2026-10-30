import { useEffect, useState } from 'react';
import { KeyRound, Share2 } from 'lucide-react';
import { api, ApiError, SharingOverview } from '../lib/api';

const SOURCE_LABEL: Record<string, string> = {
  PORTAL: 'Sign-up form',
  PORTAL_ACCOUNT: 'Account settings',
  SHARING_CODE: 'Code given at the clinic',
  USSD: 'Phone menu (USSD)',
  STAFF_ASSISTED: 'Registered at a clinic',
  OWNER: 'Account deleted',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Shown at the top of the profile while a clinic has asked to see the
 * patient's records from other clinics. Checks again every 15 seconds, since
 * the patient is usually standing at the front desk.
 */
export function RecordRequestsNotice() {
  const [overview, setOverview] = useState<SharingOverview | null>(null);
  const [shown, setShown] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getSharing()
        .then((o) => !cancelled && setOverview(o))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!overview || overview.openRequests.length === 0) return null;

  async function show(requestId: string): Promise<void> {
    setError(null);
    try {
      const res = await api.showSharingCode(requestId);
      setShown((s) => ({ ...s, [requestId]: res }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not get a code. Try again.');
    }
  }

  return (
    <div className="panel" role="region" aria-label="Requests to see your records">
      {overview.openRequests.map((r) => (
        <div key={r.requestId} style={{ marginBottom: 12 }}>
          <h2>
            <KeyRound size={18} aria-hidden /> {r.clinicName} asks to see your records from other clinics
          </h2>
          <p>
            Only if you agree, give the front desk this code. They will see your past visits at other ACISI clinics until the
            end of today. If you don&apos;t agree, do nothing: they will only see their own visits.
          </p>
          {shown[r.requestId] ? (
            <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4 }} aria-live="polite">
              {shown[r.requestId]!.code}
              <span style={{ display: 'block', fontSize: 14, fontWeight: 400, letterSpacing: 0 }}>
                Valid until {new Date(shown[r.requestId]!.expiresAt).toLocaleTimeString('en-KE', { timeStyle: 'short' })}. Any
                code sent by SMS no longer works.
              </span>
            </p>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void show(r.requestId)}>
              Show my code
            </button>
          )}
        </div>
      ))}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** Account tab: the standing sharing switch, today's access and every decision with date and source. */
export function SharingPanel() {
  const [overview, setOverview] = useState<SharingOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSharing()
      .then(setOverview)
      .catch(() => setError('Could not load your sharing settings.'));
  }, []);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setOverview(await api.setSharing(next));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        <Share2 size={18} aria-hidden /> Sharing your records with other clinics
      </h2>
      <p>
        When this is on, any ACISI clinic you visit can see your past visits at other ACISI clinics, which helps them care for
        you. When it is off, a clinic sees only its own visits, unless you give its front desk a one-time code from this page.
        You can change this at any time.
      </p>
      {overview && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
          <input type="checkbox" checked={overview.allowSharing} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
          Allow ACISI clinics I visit to see my records from other clinics
        </label>
      )}
      {error && <p className="error-text">{error}</p>}
      {overview && overview.accessToday.length > 0 && (
        <p>
          With a code today: {overview.accessToday.map((a) => `${a.clinicName} (until ${new Date(a.until).toLocaleTimeString('en-KE', { timeStyle: 'short' })})`).join(', ')}.
          Turning sharing off ends this straight away.
        </p>
      )}
      {overview && overview.decisions.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Your sharing decisions</summary>
          <ul>
            {overview.decisions.map((d, i) => (
              <li key={i}>
                {when(d.at)}:{' '}
                {d.kind === 'ALLOWED' ? 'Sharing allowed' : d.kind === 'NOT_ALLOWED' ? 'Sharing not allowed' : `One-day access for ${d.clinicName ?? 'a clinic'}`}{' '}
                ({SOURCE_LABEL[d.source] ?? d.source})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
