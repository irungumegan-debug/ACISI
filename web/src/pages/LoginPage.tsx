import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, PhonePerson } from '../lib/api';
import { PatientCodeFlow } from '../components/PatientCodeFlow';
import { usePatientAuth } from '../context/PatientAuthContext';
import { AuthShell, RoleCard } from '../components/AuthShell';

type Role = 'patient' | 'doctor' | 'staff';

/** `notice` is shown above a login form — e.g. after a successful PIN reset. */
type Step =
  | { kind: 'picker' }
  | { kind: Role; notice?: string }
  | { kind: 'forgot-pin'; role: Role }
  /** Patients: the one-time-code flow (first login, or forgot PIN). */
  | { kind: 'patient-code'; mode: 'first-login' | 'reset' };

const PIN_RESET_NOTICE = 'Your PIN has been updated. Log in with your new PIN.';

/**
 * The staff console's own login page links here as /login?reset=staff, so
 * "forgot PIN" lives in one place for staff, doctors and patients alike.
 */
function initialStep(): Step {
  return new URLSearchParams(window.location.search).get('reset') === 'staff'
    ? { kind: 'forgot-pin', role: 'staff' }
    : { kind: 'picker' };
}

export function LoginPage() {
  const [step, setStep] = useState<Step>(initialStep);

  return (
    <AuthShell>

        {step.kind === 'picker' && <RolePicker onPick={(kind) => setStep({ kind } as Step)} />}
        {step.kind === 'patient' && (
          <PatientLoginForm
            notice={step.notice}
            onBack={() => setStep({ kind: 'picker' })}
            onForgotPin={() => setStep({ kind: 'patient-code', mode: 'reset' })}
            onFirstLogin={() => setStep({ kind: 'patient-code', mode: 'first-login' })}
          />
        )}
        {step.kind === 'patient-code' && <PatientCodeFlow mode={step.mode} onBack={() => setStep({ kind: 'patient' })} />}
        {(step.kind === 'doctor' || step.kind === 'staff') && (
          <StaffLoginForm
            role={step.kind}
            notice={step.notice}
            onBack={() => setStep({ kind: 'picker' })}
            onForgotPin={() => setStep({ kind: 'forgot-pin', role: step.kind as 'doctor' | 'staff' })}
          />
        )}
        {step.kind === 'forgot-pin' && step.role !== 'patient' && (
          <ForgotPinForm
            role={step.role}
            onBack={() => setStep({ kind: step.role })}
            onDone={() => setStep({ kind: step.role, notice: PIN_RESET_NOTICE })}
          />
        )}

        {step.kind === 'picker' && (
          <p className="auth-switch">
            New here? <Link to="/signup">Sign up</Link>
          </p>
        )}
    </AuthShell>
  );
}

/**
 * Shown in place of the plain error when login returns 429 (too many wrong
 * PINs): says how long the lock lasts and offers the SMS reset right there,
 * since a successful reset lifts the lock immediately.
 */
function LockedOutMessage({ onForgotPin }: { onForgotPin: () => void }) {
  return (
    <p className="auth-error">
      Too many wrong PINs, so login is paused for up to 15 minutes. Forgot your PIN?{' '}
      <button type="button" className="auth-inline-link" onClick={onForgotPin}>
        Reset it by SMS now
      </button>{' '}
      to get back in straight away.
    </p>
  );
}

function RolePicker({ onPick }: { onPick: (kind: Role) => void }) {
  return (
    <>
      <h1 className="auth-h1">Log in</h1>
      <p className="auth-sub">Who&apos;s logging in?</p>
      <div className="role-cards">
        <RoleCard role="patient" title="Patient" sub="Phone number or ACISI ID, plus PIN" onPick={() => onPick('patient')} />
        <RoleCard role="doctor" title="Doctor" sub="Staff ID and PIN" onPick={() => onPick('doctor')} />
        <RoleCard role="staff" title="Front desk staff" sub="Staff ID and PIN" onPick={() => onPick('staff')} />
      </div>
    </>
  );
}

function PatientLoginForm({
  notice,
  onBack,
  onForgotPin,
  onFirstLogin,
}: {
  notice?: string;
  onBack: () => void;
  onForgotPin: () => void;
  onFirstLogin: () => void;
}) {
  const navigate = useNavigate();
  const { login } = usePatientAuth();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [choose, setChoose] = useState<PhonePerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(patientId?: string): Promise<void> {
    setError(null);
    setLockedOut(false);
    setSubmitting(true);
    try {
      // login() updates PatientAuthContext's session itself — required
      // before navigating client-side, since PatientLayout's guard reads
      // that context state, not a fresh fetch.
      const result = await login(identifier, pin, keepSignedIn, patientId);
      if ('choose' in result) {
        setChoose(result.choose);
        return;
      }
      navigate('/patient', { replace: true });
    } catch (err) {
      setChoose(null);
      if (err instanceof ApiError && err.status === 429) {
        setLockedOut(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (choose) {
    return (
      <div className="auth-form">
        <button type="button" className="auth-back" onClick={() => setChoose(null)}>
          &larr; Back
        </button>
        <h1 className="auth-h1">Who are you?</h1>
        <p className="auth-sub">That PIN belongs to more than one person on this phone. Choose yourself.</p>
        <div className="role-cards">
          {choose.map((p) => (
            <button key={p.id} type="button" className="role-card tone-teal" disabled={submitting} onClick={() => void submit(p.id)}>
              <span className="role-card-text">
                <span className="role-card-title">{p.displayName}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="auth-note">Tip: log in with your own ACISI ID instead of the phone number to skip this step.</p>
      </div>
    );
  }

  return (
    <form
      className="auth-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
    >
      <button type="button" className="auth-back" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="auth-h1">Patient login</h1>
      <p className="auth-sub">Your phone number or ACISI ID, plus your 6-digit PIN.</p>
      {notice && <p className="auth-notice">{notice}</p>}

      <div className="field">
        <label htmlFor="pl-id">Phone number or ACISI ID</label>
        <input id="pl-id" type="text" required autoComplete="username" placeholder="07XX XXX XXX or ACS-48217" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        <p className="field-hint">Share a phone with family? Log in with your own ACISI ID (e.g. ACS-48217) instead of the phone number.</p>
      </div>
      <div className="field">
        <label htmlFor="pl-pin">PIN</label>
        <input id="pl-pin" type="password" inputMode="numeric" autoComplete="current-password" required maxLength={6} placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>
      <label className="legal-check">
        <input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />
        <span>Keep me signed in (only on your own phone or computer)</span>
      </label>

      {lockedOut && <LockedOutMessage onForgotPin={onForgotPin} />}
      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
      <p className="auth-note">
        First time logging in, or registered by your clinic?{' '}
        <button type="button" onClick={onFirstLogin}>
          Get a code by SMS
        </button>
      </p>
      <p className="auth-note">
        Forgot your PIN?{' '}
        <button type="button" onClick={onForgotPin}>
          Reset it by SMS
        </button>
      </p>
    </form>
  );
}

/**
 * Self-service PIN reset for staff and doctors (by staff ID): the code goes
 * by SMS to the phone number on the account, and a successful reset also
 * lifts any "too many attempts" lockout. Patients reset with
 * PatientCodeFlow instead (code + date of birth).
 */
function ForgotPinForm({ onBack, onDone }: { role: Role; onBack: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<'request' | 'reset'>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.forgotStaffPin(identifier);
      setMessage(res.message);
      setPhase('reset');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.resetStaffPin(identifier, code, newPin);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'request') {
    return (
      <form className="auth-form" onSubmit={(e) => void handleRequest(e)}>
        <button type="button" className="auth-back" onClick={onBack}>
          &larr; Back
        </button>
        <h1 className="auth-h1">Reset your PIN</h1>
        <p className="auth-sub">
          Enter your staff ID — we&apos;ll text a one-time code to the phone number on your account.
        </p>
        <div className="field">
          <label>Staff ID</label>
          <input
            type="text"
            required
            placeholder="ACI-STF-2091"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send code'}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleReset(e)}>
      <button type="button" className="auth-back" onClick={() => setPhase('request')}>
        &larr; Back
      </button>
      <h1 className="auth-h1">Enter your code</h1>
      <p className="auth-sub">{message ?? 'Enter the code we texted you, and set a new PIN.'}</p>
      <div className="field">
        <label>One-time code</label>
        <input type="text" inputMode="numeric" required maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <div className="field">
        <label>New PIN</label>
        <input type="password" inputMode="numeric" required minLength={6} maxLength={6} pattern="\d{6}" placeholder="6-digit PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
        <p className="field-hint">6 digits. Avoid birthdays, your phone number, and easy patterns like 123456 or 111111.</p>
      </div>
      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Set new PIN'}
      </button>
    </form>
  );
}

function StaffLoginForm({
  role,
  notice,
  onBack,
  onForgotPin,
}: {
  role: 'doctor' | 'staff';
  notice?: string;
  onBack: () => void;
  onForgotPin: () => void;
}) {
  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLockedOut(false);
    setSubmitting(true);
    try {
      const session = await api.staffLogin(staffCode, pin);
      // Separate SPA bundle (dashboard/) served at /console — a full
      // navigation is correct here, not client-side routing, since the
      // session cookie set by the fetch above is all it needs to pick up.
      window.location.href = session.role === 'DOCTOR' ? '/console/doctor/queue' : '/console/queue';
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setLockedOut(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
      <button type="button" className="auth-back" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="auth-h1">{role === 'doctor' ? 'Doctor login' : 'Staff login'}</h1>
      <p className="auth-sub">Your ACISI staff ID, issued when your clinic set up your account, plus your PIN.</p>
      {notice && <p className="auth-notice">{notice}</p>}

      <div className="field">
        <label>Staff ID</label>
        <input type="text" required placeholder="ACI-STF-2091" value={staffCode} onChange={(e) => setStaffCode(e.target.value)} />
      </div>
      <div className="field">
        <label>PIN</label>
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>

      {lockedOut && <LockedOutMessage onForgotPin={onForgotPin} />}
      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
      <p className="auth-note">
        Forgot your PIN?{' '}
        <button type="button" onClick={onForgotPin}>
          We&apos;ll text you a code
        </button>
      </p>
    </form>
  );
}
