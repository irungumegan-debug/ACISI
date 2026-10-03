import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';
import { AuthShell, RoleCard } from '../components/AuthShell';
import { Check, Plus, X } from 'lucide-react';
import { CODE_PATTERN, cleanName, nameKey, SUGGESTED_DEPARTMENTS, suggestCode } from '../lib/departments';

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
    <AuthShell>

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
    </AuthShell>
  );
}

function RolePicker({ onPick }: { onPick: (kind: 'patient' | 'doctor' | 'staff' | 'clinic') => void }) {
  return (
    <>
      <h1 className="auth-h1">Create your account</h1>
      <p className="auth-sub">Start by telling us who you are.</p>
      <div className="role-cards">
        <RoleCard role="patient" title="Patient" sub="Check in and view your records" onPick={() => onPick('patient')} />
        <RoleCard role="doctor" title="Doctor" sub="Consult and manage prescriptions" onPick={() => onPick('doctor')} />
        <RoleCard role="staff" title="Front desk staff" sub="Manage the queue and checkout" onPick={() => onPick('staff')} />
        <RoleCard role="clinic" title="Register your clinic" sub="First time on ACISI? Start here as clinic admin" onPick={() => onPick('clinic')} />
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
  const [email, setEmail] = useState('');
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
        email: email || undefined,
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
        <input type="text" required placeholder="Lisa Jane" value={fullName} onChange={(e) => setFullName(e.target.value)} />
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
        <label>Email (optional)</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Create a PIN</label>
        <input type="password" inputMode="numeric" required minLength={6} maxLength={6} pattern="\d{6}" placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="field-hint">6 digits. Avoid birthdays, your phone number, and easy patterns like 123456 or 111111.</p>
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
        <input type="text" required placeholder={role === 'DOCTOR' ? 'Dr. Matthew James' : 'Sarah Grace'} value={name} onChange={(e) => setName(e.target.value)} />
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
        <input type="password" inputMode="numeric" required minLength={6} maxLength={6} pattern="\d{6}" placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="field-hint">6 digits. Avoid birthdays, your phone number, and easy patterns like 123456 or 111111.</p>
      </div>

      {error && <p className="auth-error">{error}</p>}
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

interface DraftDepartment {
  name: string;
  code: string;
  fee: string;
}

function ClinicSignupForm({ onBack, onDone }: { onBack: () => void; onDone: (inviteCode: string, staffCode: string) => void }) {
  const [step, setStep] = useState<'details' | 'departments'>('details');
  const [name, setName] = useState('');
  const [county, setCounty] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPhoneNumber, setAdminPhoneNumber] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [departments, setDepartments] = useState<DraftDepartment[]>([{ name: 'General', code: 'GEN', fee: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (step === 'details') {
      setError(null);
      setStep('departments');
      return;
    }
    const problem = departmentsProblem(departments);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.registerClinic({
        name,
        county: county || undefined,
        adminName,
        adminPhoneNumber,
        adminPin,
        departments: departments.map((d) => ({ name: cleanName(d.name), code: d.code.trim().toUpperCase(), consultationFeeKes: d.fee.trim() ? Number(d.fee.trim()) : null })),
      });
      onDone(res.inviteCode, res.staffCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
      <button
        type="button"
        className="auth-back"
        onClick={() => {
          setError(null);
          if (step === 'departments') setStep('details');
          else onBack();
        }}
      >
        &larr; Back
      </button>
      <p className="step-pill">Step {step === 'details' ? 1 : 2} of 2</p>
      {step === 'details' ? (
        <>
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
            <input type="password" inputMode="numeric" required minLength={6} maxLength={6} pattern="\d{6}" placeholder="6-digit PIN" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} />
            <p className="field-hint">6 digits. Avoid birthdays, your phone number, and easy patterns like 123456 or 111111.</p>
          </div>

          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit">
            Continue to departments
          </button>
        </>
      ) : (
        <>
          <h1 className="auth-h1">Your departments</h1>
          <p className="auth-sub">
            Patients pick one when they check in, and doctors only see their own departments&apos; patients. You can change
            these any time in Settings.
          </p>
          <DepartmentPicker departments={departments} onChange={setDepartments} />
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Registering…' : 'Register clinic'}
          </button>
        </>
      )}
    </form>
  );
}

/** What's wrong with the department list, if anything (the server checks the same rules). */
function departmentsProblem(list: DraftDepartment[]): string | null {
  if (list.length === 0) return 'Add at least one department.';
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const d of list) {
    const n = cleanName(d.name);
    if (n.length < 2) return 'Each department needs a name of at least 2 characters.';
    if (names.has(nameKey(n))) return `"${n}" is listed twice.`;
    names.add(nameKey(n));
    const code = d.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return `The short code for ${n} must be 2–6 capital letters or numbers, e.g. GEN.`;
    if (codes.has(code)) return `The short code ${code} is used twice.`;
    codes.add(code);
    if (d.fee.trim() && !/^\d{1,7}$/.test(d.fee.trim())) return `The fee for ${n} must be a whole number of KES.`;
  }
  return null;
}

function DepartmentPicker({ departments, onChange }: { departments: DraftDepartment[]; onChange: (next: DraftDepartment[]) => void }) {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const has = (n: string) => departments.some((d) => nameKey(d.name) === nameKey(n));

  function add(rawName: string): boolean {
    const n = cleanName(rawName);
    if (n.length < 2) {
      setCustomError('Type a department name (at least 2 characters).');
      return false;
    }
    if (has(n)) {
      setCustomError(`"${n}" is already in your list.`);
      return false;
    }
    setCustomError(null);
    onChange([...departments, { name: n, code: suggestCode(n, departments.map((d) => d.code.toUpperCase())), fee: '' }]);
    return true;
  }

  function toggle(n: string) {
    if (has(n)) onChange(departments.filter((d) => nameKey(d.name) !== nameKey(n)));
    else add(n);
  }

  function update(i: number, patch: Partial<DraftDepartment>) {
    onChange(departments.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  return (
    <div className="dept-picker">
      <p className="field-label-dark">Tap to add common departments</p>
      <div className="dept-suggestions" role="group" aria-label="Suggested departments">
        {SUGGESTED_DEPARTMENTS.map((n) => (
          <button key={n} type="button" className={`dept-chip${has(n) ? ' is-on' : ''}`} aria-pressed={has(n)} onClick={() => toggle(n)}>
            {has(n) ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />} {n}
          </button>
        ))}
      </div>

      <div className="field dept-add">
        <label htmlFor="dept-custom">Add your own department</label>
        <div className="dept-add-row">
          <input
            id="dept-custom"
            type="text"
            maxLength={60}
            placeholder="e.g. Braces, Invisalign, Oral Surgery"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (add(custom)) setCustom('');
              }
            }}
          />
          <button type="button" className="dept-add-btn" onClick={() => add(custom) && setCustom('')}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
        {customError && <p className="field-hint dept-hint-error">{customError}</p>}
      </div>

      <p className="field-label-dark">
        Your departments <span className="dept-count">{departments.length}</span>
      </p>
      {departments.length === 0 ? (
        <p className="dept-empty">Add at least one department.</p>
      ) : (
        <ul className="dept-list">
          {departments.map((d, i) => (
            <li key={`${nameKey(d.name)}-${i}`} className="dept-row">
              <div className="dept-row-head">
                <span className="dept-row-name">{d.name}</span>
                <button type="button" className="dept-remove" aria-label={`Remove ${d.name}`} onClick={() => onChange(departments.filter((_, j) => j !== i))}>
                  <X size={16} aria-hidden />
                </button>
              </div>
              <div className="dept-row-fields">
                <label>
                  <span>Short code</span>
                  <input value={d.code} maxLength={6} onChange={(e) => update(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
                </label>
                <label>
                  <span>Consultation fee (KES, optional)</span>
                  <input inputMode="numeric" placeholder="Clinic default" value={d.fee} onChange={(e) => update(i, { fee: e.target.value.replace(/[^\d]/g, '') })} />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaffConfirm({ staffCode }: { staffCode: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="confirm-badge">
        <Check size={26} aria-hidden />
      </div>
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
      <div className="confirm-badge">
        <Check size={26} aria-hidden />
      </div>
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
