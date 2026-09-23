import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';

type Step =
  | { kind: 'picker' }
  | { kind: 'patient' }
  | { kind: 'doctor' }
  | { kind: 'staff' }
  | { kind: 'clinic' }
  | { kind: 'staff-confirm'; staffCode: string }
  | { kind: 'clinic-confirm'; inviteCode: string; staffCode: string };

export function SignupPage() {
  const [step, setStep] = useState<Step>({ kind: 'picker' });

  return (
    <div className="auth-page">
      <div className="auth-wrap">
        <Link className="nav-brand" to="/" style={{ display: 'block', marginBottom: 36 }}>
          ACISI
        </Link>

        {step.kind === 'picker' && <RolePicker onPick={(kind) => setStep({ kind } as Step)} />}
        {step.kind === 'patient' && <PatientSignupForm onBack={() => setStep({ kind: 'picker' })} />}
        {step.kind === 'doctor' && (
          <StaffSignupForm role="DOCTOR" onBack={() => setStep({ kind: 'picker' })} onDone={(staffCode) => setStep({ kind: 'staff-confirm', staffCode })} />
        )}
        {step.kind === 'staff' && (
          <StaffSignupForm role="RECEPTIONIST" onBack={() => setStep({ kind: 'picker' })} onDone={(staffCode) => setStep({ kind: 'staff-confirm', staffCode })} />
        )}
        {step.kind === 'clinic' && (
          <ClinicSignupForm
            onBack={() => setStep({ kind: 'picker' })}
            onDone={(inviteCode, staffCode) => setStep({ kind: 'clinic-confirm', inviteCode, staffCode })}
          />
        )}
        {step.kind === 'staff-confirm' && <StaffConfirm staffCode={step.staffCode} />}
        {step.kind === 'clinic-confirm' && <ClinicConfirm inviteCode={step.inviteCode} staffCode={step.staffCode} />}

        {step.kind === 'picker' && (
          <p className="auth-switch">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        )}
      </div>
    </div>
  );
}

function RolePicker({ onPick }: { onPick: (kind: 'patient' | 'doctor' | 'staff' | 'clinic') => void }) {
  return (
    <>
      <h1 className="auth-h1">Create your account</h1>
      <p className="auth-sub">Start by telling us who you are.</p>
      <div className="role-cards">
        <button className="role-card" onClick={() => onPick('patient')}>
          <span className="role-card-title">Patient</span>
          <span className="role-card-sub">Check in and view your records</span>
        </button>
        <button className="role-card" onClick={() => onPick('doctor')}>
          <span className="role-card-title">Doctor</span>
          <span className="role-card-sub">Consult and manage prescriptions</span>
        </button>
        <button className="role-card" onClick={() => onPick('staff')}>
          <span className="role-card-title">Front desk staff</span>
          <span className="role-card-sub">Manage the queue and checkout</span>
        </button>
        <button className="role-card" onClick={() => onPick('clinic')}>
          <span className="role-card-title">Register your clinic</span>
          <span className="role-card-sub">First time on ACISI? Start here as clinic admin</span>
        </button>
      </div>
    </>
  );
}

function PatientSignupForm({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { setSession } = usePatientAuth();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [pin, setPin] = useState('');
  const [crossClinicConsent, setCrossClinicConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) {
      setError('Please enter both first and last name.');
      return;
    }

    setSubmitting(true);
    try {
      const session = await api.registerPatient({
        firstName: parts[0] as string,
        lastName: parts.slice(1).join(' '),
        phoneNumber,
        dateOfBirth: dateOfBirth || undefined,
        pin,
        crossClinicConsent,
      });
      // Same fix as patient login: update PatientAuthContext's session
      // directly (registration already returns it) before navigating
      // client-side — PatientLayout's guard reads context state, not a
      // fresh fetch, and this stays within the same SPA so there's no
      // reload to trigger that fetch for us.
      setSession(session);
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
      <h1 className="auth-h1">Patient sign up</h1>
      <p className="auth-sub">Takes a minute. You&apos;ll get a patient ID once you&apos;re done.</p>

      <div className="field">
        <label>Full name</label>
        <input type="text" required placeholder="Jane Wanjiru" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="field">
        <label>Phone number</label>
        <input type="tel" required placeholder="07XX XXX XXX" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
      </div>
      <div className="field">
        <label>Date of birth</label>
        <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
      </div>
      <div className="field">
        <label>Create a PIN</label>
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>
      <label style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--ink-dim)', marginBottom: 16, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={crossClinicConsent} onChange={(e) => setCrossClinicConsent(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
        <span>Share my records with other ACISI-connected clinics too (optional — off by default, you can check in elsewhere either way).</span>
      </label>

      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

function StaffSignupForm({
  role,
  onBack,
  onDone,
}: {
  role: 'DOCTOR' | 'RECEPTIONIST';
  onBack: () => void;
  onDone: (staffCode: string) => void;
}) {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pin, setPin] = useState('');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [inviteCodeChecked, setInviteCodeChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function checkInviteCode(): Promise<void> {
    if (role !== 'DOCTOR' || !inviteCode.trim()) return;
    setError(null);
    try {
      const res = await api.getDepartmentsByInviteCode(inviteCode.trim());
      setDepartments(res.departments);
      setInviteCodeChecked(true);
      if (res.departments.length > 0) setDepartmentId(res.departments[0]!.id);
    } catch {
      setDepartments([]);
      setInviteCodeChecked(false);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!inviteCode.trim()) {
      setError('Enter the clinic invite code your admin shared with you first.');
      return;
    }
    if (role === 'DOCTOR' && !departmentId) {
      setError('Please choose which department you’re joining.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.registerStaff({
        name,
        phoneNumber,
        inviteCode: inviteCode.trim(),
        pin,
        role,
        departmentId: role === 'DOCTOR' ? departmentId : undefined,
      });
      onDone(res.staffCode);
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
      <h1 className="auth-h1">{role === 'DOCTOR' ? 'Doctor sign up' : 'Staff sign up'}</h1>
      <p className="auth-sub">
        {role === 'DOCTOR'
          ? "Doctor accounts are set up by your clinic. If your clinic is already on ACISI, ask your admin for an invite code."
          : 'Staff accounts are set up by your clinic administrator, the same as doctor accounts, to keep the front desk secure.'}
      </p>

      <div className="field">
        <label>Full name</label>
        <input type="text" required placeholder={role === 'DOCTOR' ? 'Dr. Amani Wambui' : 'Anne Otieno'} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Phone number</label>
        <input type="tel" required placeholder="07XX XXX XXX" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
      </div>
      <div className="field">
        <label>Clinic invite code</label>
        <input
          type="text"
          required
          placeholder="Provided by your clinic"
          value={inviteCode}
          onChange={(e) => {
            setInviteCode(e.target.value);
            setInviteCodeChecked(false);
          }}
          onBlur={() => void checkInviteCode()}
        />
      </div>
      {role === 'DOCTOR' && inviteCodeChecked && (
        <div className="field">
          <label>Department</label>
          {departments.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>No departments found for that invite code.</p>
          ) : (
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="field">
        <label>Create a PIN</label>
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>

      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

function ClinicSignupForm({ onBack, onDone }: { onBack: () => void; onDone: (inviteCode: string, staffCode: string) => void }) {
  const [name, setName] = useState('');
  const [county, setCounty] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPhoneNumber, setAdminPhoneNumber] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.registerClinic({ name, county: county || undefined, adminName, adminPhoneNumber, adminPin });
      onDone(res.inviteCode, res.staffCode);
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
      <h1 className="auth-h1">Register your clinic</h1>
      <p className="auth-sub">
        You&apos;ll become this clinic&apos;s admin on ACISI, and can invite your doctors and front-desk staff right
        after.
      </p>

      <div className="field">
        <label>Clinic name</label>
        <input type="text" required placeholder="Sunrise Family Clinic" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Clinic location</label>
        <input type="text" placeholder="Kenyatta Market, Nairobi" value={county} onChange={(e) => setCounty(e.target.value)} />
      </div>
      <div className="field">
        <label>Your full name</label>
        <input type="text" required placeholder="You'll be the clinic admin" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
      </div>
      <div className="field">
        <label>Phone number</label>
        <input type="tel" required placeholder="07XX XXX XXX" value={adminPhoneNumber} onChange={(e) => setAdminPhoneNumber(e.target.value)} />
      </div>
      <div className="field">
        <label>Create a PIN</label>
        <input type="password" inputMode="numeric" required maxLength={6} placeholder="4-digit PIN" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} />
      </div>

      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Registering…' : 'Register clinic'}
      </button>
    </form>
  );
}

function StaffConfirm({ staffCode }: { staffCode: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="confirm-badge">&#10003;</div>
      <h1 className="auth-h1">You&apos;re set up</h1>
      <p className="auth-sub">Your clinic&apos;s invite code was recognized. Here&apos;s your own ACISI staff ID.</p>
      <div className="confirm-code-box">
        <p className="label">Your staff ID</p>
        <p className="code">{staffCode}</p>
      </div>
      <p className="auth-note">Use this staff ID and the PIN you just set to log in from now on.</p>
      <p className="auth-switch">
        <Link to="/login">Log in now</Link>
      </p>
    </div>
  );
}

function ClinicConfirm({ inviteCode, staffCode }: { inviteCode: string; staffCode: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="confirm-badge">&#10003;</div>
      <h1 className="auth-h1">Your clinic is registered</h1>
      <p className="auth-sub">
        You&apos;re now the clinic admin. Share this invite code with your doctors and front-desk staff so they can
        create their own accounts.
      </p>
      <div className="confirm-code-box">
        <p className="label">Clinic invite code</p>
        <p className="code">{inviteCode}</p>
      </div>
      <div className="confirm-code-box">
        <p className="label">Your admin staff ID</p>
        <p className="code">{staffCode}</p>
      </div>
      <p className="auth-note">Keep both somewhere safe. You&apos;ll use your staff ID and a PIN to log in from now on.</p>
      <p className="auth-switch">
        <Link to="/login">Log in now</Link>
      </p>
    </div>
  );
}
