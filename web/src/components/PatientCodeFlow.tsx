import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, PatientSession, PhonePerson } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';
import { legalBoxSatisfied, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';

/**
 * The one-time-code flow, used for exactly three things:
 *   - "first-login": a patient registered by a clinic (or over USSD) logs in
 *     for the first time — or an existing patient who has never set a PIN;
 *   - "reset": forgot PIN;
 *   - "signup": a patient creating their own account.
 * Steps: phone → code by SMS → which person (shared phones) → date of birth
 * → PIN twice → logged in. The portal then shows the ACISI ID screen.
 */
export type CodeFlowMode = 'first-login' | 'reset' | 'signup';

type Phase =
  | { kind: 'phone' }
  | { kind: 'code' }
  | { kind: 'who'; people: PhonePerson[] }
  | { kind: 'dob' }
  | { kind: 'pin' }
  | { kind: 'signup' }
  | { kind: 'no-dob' };

const PIN_HINT = '6 digits. Avoid your date of birth, your phone number, and easy patterns like 123456 or 111111.';

export function PatientCodeFlow({ mode, onBack }: { mode: CodeFlowMode; onBack: () => void }) {
  const navigate = useNavigate();
  const { setSession } = usePatientAuth();
  const purpose = mode === 'reset' ? 'reset' : 'login';
  const [phase, setPhase] = useState<Phase>({ kind: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [flowToken, setFlowToken] = useState('');
  const [dob, setDob] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Signup fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [email, setEmail] = useState('');
  const [acceptLegal, setAcceptLegal] = useState(false);

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.body.reason === 'no_dob_on_file') {
        setPhase({ kind: 'no-dob' });
      } else if (err instanceof ApiError && err.status === 401 && phase.kind !== 'phone' && phase.kind !== 'code') {
        setError('This took too long, so we stopped for your safety. Start again with your phone number.');
        setPhase({ kind: 'phone' });
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function finish(session: PatientSession): void {
    // Update the context before navigating — PatientLayout's guard reads it.
    setSession(session);
    navigate('/patient', { replace: true });
  }

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      const res = await api.requestPatientCode(phone, purpose);
      setNotice(res.message);
      setCode('');
      setPhase({ kind: 'code' });
    });
  };

  const checkCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api.verifyPatientCode(phone, purpose, code);
      setFlowToken(res.flowToken);
      setNotice(null);
      if (res.people.length === 0) {
        if (mode === 'reset') throw new ApiError('There is no ACISI account on this phone number.', 404);
        setPhase({ kind: 'signup' });
      } else if (res.people.length === 1 && mode !== 'signup') {
        setPhase({ kind: 'dob' });
      } else {
        setPhase({ kind: 'who', people: res.people });
      }
    });
  };

  const pickPerson = (p: PhonePerson) =>
    void run(async () => {
      await api.selectSetupPerson(flowToken, p.id);
      setPhase({ kind: 'dob' });
    });

  const checkDob = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.verifySetupDateOfBirth(flowToken, dob);
      setPhase({ kind: 'pin' });
    });
  };

  const savePin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => finish(await api.setSetupPin(flowToken, pin, pinConfirm, keepSignedIn)));
  };

  const signup = (e: FormEvent) => {
    e.preventDefault();
    if (!legalBoxSatisfied(true, acceptLegal) || !sex) return;
    void run(async () =>
      finish(
        await api.registerPatientAfterCode({
          flowToken,
          firstName,
          lastName,
          dateOfBirth: dob,
          sex,
          pin,
          pinConfirm,
          email: email || undefined,
          acceptLegal,
          keepSignedIn,
        }),
      ),
    );
  };

  const title = mode === 'reset' ? 'Reset your PIN' : mode === 'signup' ? 'Patient sign up' : 'First time logging in';
  const back = (
    <button type="button" className="auth-back" onClick={phase.kind === 'phone' ? onBack : () => setPhase({ kind: 'phone' })}>
      &larr; Back
    </button>
  );
  const errorText = error && <p className="auth-error">{error}</p>;
  const keepSignedInBox = (
    <label className="legal-check">
      <input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />
      <span>Keep me signed in on this device (only on your own phone or computer).</span>
    </label>
  );
  const pinFields = (
    <>
      <div className="field">
        <label htmlFor="cf-pin">{mode === 'reset' ? 'New 6-digit PIN' : 'Choose a 6-digit PIN'}</label>
        <input id="cf-pin" type="password" inputMode="numeric" autoComplete="new-password" required minLength={6} maxLength={6} pattern="\d{6}" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="field-hint">{PIN_HINT}</p>
      </div>
      <div className="field">
        <label htmlFor="cf-pin2">Enter the PIN again</label>
        <input id="cf-pin2" type="password" inputMode="numeric" autoComplete="new-password" required minLength={6} maxLength={6} pattern="\d{6}" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} />
      </div>
    </>
  );

  if (phase.kind === 'phone') {
    return (
      <form className="auth-form" onSubmit={sendCode}>
        {back}
        <h1 className="auth-h1">{title}</h1>
        <p className="auth-sub">
          {mode === 'reset'
            ? 'Enter the phone number on your account. We’ll text you a one-time code.'
            : 'Enter your phone number. We’ll text you a one-time code to confirm it’s yours. After this you’ll log in with a PIN — no more codes.'}
        </p>
        <div className="field">
          <label htmlFor="cf-phone">Phone number</label>
          <input id="cf-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {errorText}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Text me a code'}
        </button>
      </form>
    );
  }

  if (phase.kind === 'code') {
    return (
      <form className="auth-form" onSubmit={checkCode}>
        {back}
        <h1 className="auth-h1">Enter your code</h1>
        <p className="auth-sub">{notice}</p>
        <div className="field">
          <label htmlFor="cf-code">6-digit code</label>
          <input id="cf-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="\d{6}" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {errorText}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <p className="auth-note">
          No SMS?{' '}
          <button type="button" onClick={() => sendCode()} disabled={busy}>
            Send a new code
          </button>{' '}
          (up to 3 per hour)
        </p>
      </form>
    );
  }

  if (phase.kind === 'who') {
    return (
      <div className="auth-form">
        {back}
        <h1 className="auth-h1">Who are you?</h1>
        <p className="auth-sub">More than one person uses this phone number. Choose yourself.</p>
        <div className="role-cards">
          {phase.people.map((p) => (
            <button key={p.id} type="button" className="role-card tone-teal" onClick={() => pickPerson(p)} disabled={busy}>
              <span className="role-card-text">
                <span className="role-card-title">{p.displayName}</span>
              </span>
            </button>
          ))}
          {mode !== 'reset' && (
            <button type="button" className="role-card tone-gold" onClick={() => setPhase({ kind: 'signup' })} disabled={busy}>
              <span className="role-card-text">
                <span className="role-card-title">Someone else — create a new account</span>
                <span className="role-card-sub">For a family member who isn’t on ACISI yet</span>
              </span>
            </button>
          )}
        </div>
        {errorText}
      </div>
    );
  }

  if (phase.kind === 'dob') {
    return (
      <form className="auth-form" onSubmit={checkDob}>
        {back}
        <h1 className="auth-h1">Confirm your date of birth</h1>
        <p className="auth-sub">This keeps your account safe if a phone number ever changes hands.</p>
        <div className="field">
          <label htmlFor="cf-dob">Date of birth</label>
          <input id="cf-dob" type="date" required max={new Date().toISOString().slice(0, 10)} value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        {errorText}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    );
  }

  if (phase.kind === 'no-dob') {
    return (
      <div className="auth-form">
        {back}
        <h1 className="auth-h1">Ask your clinic first</h1>
        <p className="auth-sub">
          Your date of birth isn&apos;t on your ACISI record yet, so we can&apos;t confirm it&apos;s you. Ask the front desk at your clinic to add it,
          then come back and try again.
        </p>
      </div>
    );
  }

  if (phase.kind === 'pin') {
    return (
      <form className="auth-form" onSubmit={savePin}>
        {back}
        <h1 className="auth-h1">{mode === 'reset' ? 'Set a new PIN' : 'Set your PIN'}</h1>
        <p className="auth-sub">You&apos;ll use this PIN with your phone number or ACISI ID every time you log in. Never share it with anyone.</p>
        {pinFields}
        {keepSignedInBox}
        {errorText}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save PIN and continue'}
        </button>
      </form>
    );
  }

  // signup
  return (
    <form className="auth-form" onSubmit={signup}>
      {back}
      <h1 className="auth-h1">Create your account</h1>
      <p className="auth-sub">Your phone is confirmed. You&apos;ll get your own ACISI ID when you&apos;re done.</p>
      <div className="field">
        <label htmlFor="cf-first">First name</label>
        <input id="cf-first" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cf-last">Last name</label>
        <input id="cf-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cf-sdob">Date of birth</label>
        <input id="cf-sdob" type="date" required max={new Date().toISOString().slice(0, 10)} value={dob} onChange={(e) => setDob(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cf-sex">Sex</label>
        <select id="cf-sex" required value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
          <option value="" disabled>
            Choose…
          </option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="cf-email">Email (optional)</label>
        <input id="cf-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {pinFields}
      {keepSignedInBox}
      <label className="legal-check">
        <input type="checkbox" required checked={acceptLegal} onChange={(e) => setAcceptLegal(e.target.checked)} />
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
      {errorText}
      <button className="auth-submit" type="submit" disabled={busy || !acceptLegal || !sex}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
