import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';

type Role = 'patient' | 'doctor' | 'staff';

/** `notice` is shown above a login form — e.g. after a successful PIN reset. */
type Step = { kind: 'picker' } | { kind: Role; notice?: string } | { kind: 'forgot-pin'; role: Role };

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
    <div className="auth-page">
      <div className="auth-wrap">
        <Link className="nav-brand" to="/" style={{ display: 'block', marginBottom: 36 }}>
          ACISI
        </Link>

        {step.kind === 'picker' && <RolePicker onPick={(kind) => setStep({ kind } as Step)} />}
        {step.kind === 'patient' && (
          <PatientLoginForm
            notice={step.notice}
            onBack={() => setStep({ kind: 'picker' })}
            onForgotPin={() => setStep({ kind: 'forgot-pin', role: 'patient' })}
          />
        )}
        {(step.kind === 'doctor' || step.kind === 'staff') && (
          <StaffLoginForm
            role={step.kind}
            notice={step.notice}
            onBack={() => setStep({ kind: 'picker' })}
            onForgotPin={() => setStep({ kind: 'forgot-pin', role: step.kind as 'doctor' | 'staff' })}
          />
        )}
        {step.kind === 'forgot-pin' && (
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
      </div>
    </div>
  );
}

function RolePicker({ onPick }: { onPick: (kind: Role) => void }) {
  return (
    <>
      <h1 className="auth-h1">Log in</h1>
      <p className="auth-sub">Who&apos;s logging in?</p>
      <div className="role-cards">
        <button className="role-card" onClick={() => onPick('patient')}>
          <span className="role-card-title">Patient</span>
          <span className="role-card-sub">Phone number or patient ID, plus PIN</span>
        </button>
        <button className="role-card" onClick={() => onPick('doctor')}>
          <span className="role-card-title">Doctor</span>
          <span className="role-card-sub">Staff ID and PIN</span>
        </button>
        <button className="role-card" onClick={() => onPick('staff')}>
          <span className="role-card-title">Front desk staff</span>
          <span className="role-card-sub">Staff ID and PIN</span>
        </button>
      </div>
    </>
  );
}

function PatientLoginForm({ notice, onBack, onForgotPin }: { notice?: string; onBack: () => void; onForgotPin: () => void }) {
  const navigate = useNavigate();
  const { login } = usePatientAuth();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // login() updates PatientAuthContext's session itself — required
      // before navigating client-side, since PatientLayout's guard reads
      // that context state, not a fresh fetch.
      await login(identifier, pin);
      navigate('/patient', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
      <button type="button" className="auth-back" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="auth-h1">Patient login</h1>
      <p className="auth-sub">Your phone number or patient ID, plus the PIN you set when you signed up.</p>
      {notice && <p className="auth-notice">{notice}</p>}

      <div className="field">
        <label>Phone number or patient ID</label>
        <input type="text" required placeholder="07XX XXX XXX or ACI-1042" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      </div>
      <div className="field">
        <label>PIN</label>
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>

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

/**
 * Self-service PIN reset for anyone: patients identify themselves by phone
 * or patient ID, staff and doctors by staff ID. Either way the code goes by
 * SMS to the phone number on the account, and a successful reset also
 * lifts any "too many attempts" lockout.
 */
function ForgotPinForm({ role, onBack, onDone }: { role: Role; onBack: () => void; onDone: () => void }) {
  const isStaff = role !== 'patient';
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
      const res = isStaff ? await api.forgotStaffPin(identifier) : await api.forgotPatientPin(identifier);
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
      await (isStaff ? api.resetStaffPin(identifier, code, newPin) : api.resetPatientPin(identifier, code, newPin));
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
          {isStaff
            ? 'Enter your staff ID — we\u2019ll text a one-time code to the phone number on your account.'
            : 'Enter your phone number or patient ID — we\u2019ll text you a one-time code.'}
        </p>
        <div className="field">
          <label>{isStaff ? 'Staff ID' : 'Phone number or patient ID'}</label>
          <input
            type="text"
            required
            placeholder={isStaff ? 'ACI-STF-2091' : '07XX XXX XXX or ACI-1042'}
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
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.staffLogin(staffCode, pin);
      // Separate SPA bundle (dashboard/) served at /console — a full
      // navigation is correct here, not client-side routing, since the
      // session cookie set by the fetch above is all it needs to pick up.
      window.location.href = session.role === 'DOCTOR' ? '/console/doctor/queue' : '/console/queue';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
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
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>

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
