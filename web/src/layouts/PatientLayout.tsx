import { FormEvent, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogOut, ScrollText } from 'lucide-react';
import { usePatientAuth } from '../context/PatientAuthContext';
import { LogoMark } from '../components/Logo';
import { api, ApiError } from '../lib/api';
import { legalBoxSatisfied, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Small links at the bottom of every portal page; open in a new tab so nothing in progress is lost. */
function PortalLegalLinks() {
  return (
    <nav className="patient-legal" aria-label="Legal">
      <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer">
        Privacy Notice
      </a>
      <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer">
        Terms of Service
      </a>
    </nav>
  );
}

/**
 * Shown instead of the portal until the patient has accepted the current
 * Terms of Service: once for existing accounts (e.g. registered at a USSD
 * or walk-in check-in), and again whenever the Terms are updated.
 */
function AcceptTermsPanel({ onAccepted }: { onAccepted: () => void }) {
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!legalBoxSatisfied(true, ticked)) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.acceptPatientTerms();
      onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="page-h1">
        <ScrollText size={24} aria-hidden /> Before you continue
      </h1>
      <p className="lede">Please read and accept ACISI&apos;s Terms of Service and Privacy Notice to use the patient portal.</p>
      <form className="panel" onSubmit={(e) => void handleSubmit(e)}>
        <label className="legal-check">
          <input type="checkbox" required checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span>
            I accept the ACISI{' '}
            <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{' '}
            and have read the{' '}
            <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer">
              Privacy Notice
            </a>
            .
          </span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={!ticked || submitting}>
          {submitting ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </>
  );
}

export function PatientLayout() {
  const { session, loading, logout } = usePatientAuth();
  const location = useLocation();
  // null while checking; 'error' shows a retry rather than letting anyone past unchecked.
  const [termsStatus, setTermsStatus] = useState<'required' | 'accepted' | 'error' | null>(null);
  const patientCode = session?.patientCode;

  useEffect(() => {
    if (!patientCode) return;
    let cancelled = false;
    setTermsStatus(null);
    api
      .getPatientLegalStatus()
      .then((res) => !cancelled && setTermsStatus(res.termsAcceptanceRequired ? 'required' : 'accepted'))
      .catch(() => !cancelled && setTermsStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [patientCode]);

  if (loading) {
    return (
      <div className="patient-portal patient-loading" role="status" aria-label="Loading">
        <LogoMark size={56} title="" />
        <p className="lede">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="patient-portal">
      <header className="patient-header">
        <div className="patient-header-inner">
          <div className="patient-brand">
            <LogoMark size={36} title="" />
            <span className="brand">ACISI</span>
          </div>
          <nav aria-label="Account">
            <button type="button" onClick={() => void logout()}>
              <LogOut size={16} aria-hidden /> Log out
            </button>
          </nav>
        </div>
        <div className="patient-hello">
          <p className="hello">
            {greeting()}, {session.firstName}
          </p>
          <p className="who">
            Patient ID <span className="who-code">{session.patientCode}</span>
          </p>
        </div>
      </header>
      <main className="patient-main">
        {termsStatus === 'accepted' ? (
          <Outlet />
        ) : termsStatus === 'required' ? (
          <AcceptTermsPanel onAccepted={() => setTermsStatus('accepted')} />
        ) : termsStatus === 'error' ? (
          <div className="panel">
            <p className="error-text">We couldn&apos;t load your account. Check your connection and try again.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="skeleton-list" role="status" aria-label="Loading">
            <span />
            <span />
          </div>
        )}
        <PortalLegalLinks />
      </main>
    </div>
  );
}
