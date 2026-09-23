import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';

type Step = { kind: 'picker' } | { kind: 'patient' } | { kind: 'doctor' } | { kind: 'staff' } | { kind: 'forgot-pin' };

export function LoginPage() {
  const [step, setStep] = useState<Step>({ kind: 'picker' });

  return (
    <div className="auth-page">
      <div className="auth-wrap">
        <Link className="nav-brand" to="/" style={{ display: 'block', marginBottom: 36 }}>
          ACISI
        </Link>

        {step.kind === 'picker' && <RolePicker onPick={(kind) => setStep({ kind } as Step)} />}
        {step.kind === 'patient' && <PatientLoginForm onBack={() => setStep({ kind: 'picker' })} onForgotPin={() => setStep({ kind: 'forgot-pin' })} />}
        {step.kind === 'doctor' && <StaffLoginForm role="doctor" onBack={() => setStep({ kind: 'picker' })} />}
        {step.kind === 'staff' && <StaffLoginForm role="staff" onBack={() => setStep({ kind: 'picker' })} />}
        {step.kind === 'forgot-pin' && <ForgotPinForm onBack={() => setStep({ kind: 'patient' })} onDone={() => setStep({ kind: 'patient' })} />}

        {step.kind === 'picker' && (
          <p className="auth-switch">
            New here? <Link to="/signup">Sign up</Link>
          </p>
        )}
      </div>
    </div>
  );
}

function RolePicker({ onPick }: { onPick: (kind: 'patient' | 'doctor' | 'staff') => void }) {
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

function PatientLoginForm({ onBack, onForgotPin }: { onBack: () => void; onForgotPin: () => void }) {
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

function ForgotPinForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
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
      const res = await api.forgotPatientPin(identifier);
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
      await api.resetPatientPin(identifier, code, newPin);
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
        <p className="auth-sub">Enter your phone number or patient ID — we&apos;ll text you a one-time code.</p>
        <div className="field">
          <label>Phone number or patient ID</label>
          <input type="text" required placeholder="07XX XXX XXX or ACI-1042" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
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

function StaffLoginForm({ role, onBack }: { role: 'doctor' | 'staff'; onBack: () => void }) {
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
    </form>
  );
}
