import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, CheckInSummary, ClinicListItem, DepartmentListItem, OwnAppointment, VisitHistoryEntry } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';
import { legalBoxSatisfied, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { EMPTY_IDENTITY, IdentityFields } from '../components/IdentityFields';
import type { PatientIdentity } from '../lib/api';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Pill,
  Smartphone,
  Stethoscope,
  UserRound,
  XCircle,
} from 'lucide-react';

const TABS: { key: Tab; label: string; short: string; icon: LucideIcon }[] = [
  { key: 'checkin', label: 'Check in', short: 'Check in', icon: Smartphone },
  { key: 'book', label: 'Book appointment', short: 'Book', icon: CalendarPlus },
  { key: 'appointments', label: 'My appointments', short: 'Visits', icon: CalendarCheck },
  { key: 'records', label: 'My records', short: 'Records', icon: FileText },
  { key: 'account', label: 'Account', short: 'Account', icon: UserRound },
];

const STATUS_TONE: Record<string, string> = { REQUESTED: 'warning', CONFIRMED: 'info', CANCELLED: 'neutral', COMPLETED: 'success' };

type Tab = 'checkin' | 'book' | 'appointments' | 'records' | 'account';

/** After the M-Pesa prompt is sent: ask the server for the check-in's status this often, for this long. */
const PAYMENT_POLL_INTERVAL_MS = 3_000;
const PAYMENT_POLL_TIMEOUT_MS = 90_000;

/**
 * Where a submitted check-in stands. 'waiting' polls until the M-Pesa
 * callback marks it PAID or FAILED; 'timedOut' is the give-up state when
 * neither arrives in time.
 */
type PaymentStage =
  | { kind: 'waiting'; checkIn: CheckInSummary }
  | { kind: 'paid'; checkIn: CheckInSummary; existing: boolean }
  | { kind: 'failed' }
  | { kind: 'timedOut' };

export function PatientHomePage() {
  const { session } = usePatientAuth();
  const [tab, setTab] = useState<Tab>('checkin');

  return (
    <div>
      <nav className="tabs" aria-label="Patient portal">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${tab === t.key ? 'active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => {
              setTab(t.key);
              window.scrollTo({ top: 0 });
            }}
          >
            <t.icon size={20} aria-hidden />
            <span className="tab-label-long">{t.label}</span>
            <span className="tab-label-short">{t.short}</span>
          </button>
        ))}
      </nav>

      {tab === 'checkin' && <CheckInPanel patientCode={session?.patientCode ?? ''} />}
      {tab === 'book' && <BookAppointmentPanel patientCode={session?.patientCode ?? ''} />}
      {tab === 'appointments' && <AppointmentsPanel />}
      {tab === 'records' && <RecordsPanel patientCode={session?.patientCode ?? ''} />}
      {tab === 'account' && <AccountPanel patientCode={session?.patientCode ?? ''} />}
    </div>
  );
}

function CheckInPanel({ patientCode }: { patientCode: string }) {
  const [clinics, setClinics] = useState<ClinicListItem[]>([]);
  const [clinicId, setClinicId] = useState('');
  const [departments, setDepartments] = useState<DepartmentListItem[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<PaymentStage | null>(null);
  // Privacy Notice checkbox: asked at a patient's first check-in at each
  // clinic, and again when the notice changes. null while we ask the server.
  const [privacyAckRequired, setPrivacyAckRequired] = useState<boolean | null>(null);
  const [privacyClinicName, setPrivacyClinicName] = useState('');
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  // Optional ID and next of kin, pre-filled from the patient's record.
  const [identity, setIdentity] = useState<PatientIdentity>(EMPTY_IDENTITY);
  const [identityOnFile, setIdentityOnFile] = useState(false);

  useEffect(() => {
    api
      .getPatientDetails()
      .then((d) => {
        setIdentity({ idType: d.idType ?? '', idNumber: d.idNumber ?? '', nextOfKinName: d.nextOfKinName ?? '', nextOfKinPhone: d.nextOfKinPhone ?? '' });
        setIdentityOnFile(Boolean(d.idNumber || d.nextOfKinName || d.nextOfKinPhone));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api.listClinics().then((res) => {
      setClinics(res.clinics);
      if (res.clinics.length > 0) setClinicId(res.clinics[0]!.id);
    });
  }, []);

  useEffect(() => {
    setDepartmentId(null);
    setDepartments([]);
    if (!clinicId) return;

    let cancelled = false;
    api.getDepartmentsByClinic(clinicId).then((res) => {
      if (!cancelled) setDepartments(res.departments);
    });
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  function loadPrivacyNotice(forClinicId: string, isCancelled: () => boolean = () => false): void {
    setPrivacyAckRequired(null);
    setPrivacyAcknowledged(false);
    setPrivacyClinicName(clinics.find((c) => c.id === forClinicId)?.name ?? '');
    api
      .getCheckInPrivacyNotice(forClinicId)
      .then((res) => {
        if (isCancelled()) return;
        setPrivacyClinicName(res.clinicName);
        setPrivacyAckRequired(res.acknowledgmentRequired);
      })
      // If we can't tell, show the box: the server decides either way.
      .catch(() => !isCancelled() && setPrivacyAckRequired(true));
  }

  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    loadPrivacyNotice(clinicId, () => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the clinic changes
  }, [clinicId]);

  // Polls the check-in while we wait for M-Pesa. Stops on PAID/FAILED, after
  // PAYMENT_POLL_TIMEOUT_MS, or when the patient leaves this screen.
  const waitingCheckInId = stage?.kind === 'waiting' ? stage.checkIn.checkInId : null;
  useEffect(() => {
    if (!waitingCheckInId) return;
    let stopped = false;
    let timer: number | undefined;
    const giveUpAt = Date.now() + PAYMENT_POLL_TIMEOUT_MS;

    async function poll(): Promise<void> {
      try {
        const checkIn = await api.getCheckIn(waitingCheckInId!);
        if (stopped) return;
        if (checkIn.status === 'PAID') {
          setStage({ kind: 'paid', checkIn, existing: false });
          return;
        }
        if (checkIn.status === 'FAILED' || checkIn.status === 'CANCELLED') {
          setStage({ kind: 'failed' });
          return;
        }
      } catch {
        // A dropped request (patchy mobile data) just means try again next tick.
        if (stopped) return;
      }
      if (Date.now() >= giveUpAt) {
        setStage({ kind: 'timedOut' });
        return;
      }
      timer = window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
    }

    timer = window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [waitingCheckInId]);

  async function handleSubmit(): Promise<void> {
    if (!clinicId || !departmentId || !legalBoxSatisfied(privacyAckRequired, privacyAcknowledged)) return;
    setError(null);
    setSubmitting(true);
    try {
      const { existing, ...checkIn } = await api.patientCheckIn(
        clinicId,
        departmentId,
        privacyAckRequired === true && privacyAcknowledged,
        identity,
      );
      setPrivacyAckRequired(false);
      // Already paid here today: show that visit instead of charging again.
      setStage(checkIn.status === 'PAID' ? { kind: 'paid', checkIn, existing } : { kind: 'waiting', checkIn });
    } catch (err) {
      setStage(null);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      // e.g. the Privacy Notice was updated since this page loaded: show the box again.
      if (err instanceof ApiError && err.status === 400) loadPrivacyNotice(clinicId);
    } finally {
      setSubmitting(false);
    }
  }

  if (stage?.kind === 'waiting') {
    return (
      <div className="panel confirm" role="status" aria-live="polite">
        <div className="badge">
          <Loader2 size={28} className="spin" aria-hidden />
        </div>
        <h2>Waiting for M-Pesa confirmation…</h2>
        <p>
          {stage.checkIn.clinicName} · {stage.checkIn.departmentName}
        </p>
        <p>We&apos;ve sent an M-Pesa prompt to your phone. Enter your M-Pesa PIN to complete check-in. Keep this page open.</p>
      </div>
    );
  }

  if (stage?.kind === 'paid') {
    const { checkIn } = stage;
    return (
      <div className="panel confirm" role="status">
        <div className="badge">
          <CheckCircle2 size={28} aria-hidden />
        </div>
        <h2>{stage.existing ? 'You’re already checked in' : 'You’re checked in'}</h2>
        <p>
          <strong>{checkIn.clinicName}</strong> · {checkIn.departmentName}
        </p>
        <div className="patient-id">{patientCode}</div>
        {checkIn.queuePosition !== null && (
          <p>{checkIn.queuePosition === 1 ? 'You’re next in line.' : `You’re number ${checkIn.queuePosition} in the queue.`}</p>
        )}
        <p>Payment received. Show your patient ID at the front desk when you arrive.</p>
      </div>
    );
  }

  if (stage?.kind === 'failed' || stage?.kind === 'timedOut') {
    const failed = stage.kind === 'failed';
    return (
      <div className="panel confirm" role="alert">
        <div className="badge">{failed ? <XCircle size={28} aria-hidden /> : <Clock size={28} aria-hidden />}</div>
        <h2>{failed ? 'Payment was cancelled' : 'We didn’t hear back from M-Pesa'}</h2>
        <p>
          {failed
            ? 'The M-Pesa payment was cancelled or didn’t go through, so you are not checked in yet. No money was taken.'
            : 'We couldn’t confirm your payment yet. If you entered your PIN, wait for the M-Pesa SMS, then tap Try again: you won’t be charged twice.'}
        </p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? 'Starting…' : 'Try again'}
        </button>
        <button className="btn btn-secondary" style={{ marginTop: 8 }} disabled={submitting} onClick={() => setStage(null)}>
          Change clinic or department
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="hero-card">
        <span className="hero-card-icon">
          <Smartphone size={26} aria-hidden />
        </span>
        <div>
          <h1>Check in</h1>
          <p className="lede">Tell us where you&apos;re headed and we&apos;ll add you to the clinic&apos;s queue.</p>
        </div>
      </div>
      <div className="panel">
        <div className="field">
          <label htmlFor="checkin-clinic">Clinic</label>
          <select id="checkin-clinic" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Department</span>
          <div className="chip-row" role="group" aria-label="Department">
            {departments.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`chip ${departmentId === d.id ? 'selected' : ''}`}
                aria-pressed={departmentId === d.id}
                onClick={() => setDepartmentId(d.id)}
              >
                {departmentId === d.id && <Check size={15} aria-hidden />}
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <details className="identity-details">
          <summary>
            {identityOnFile ? 'Your ID and next of kin' : 'Add your ID and next of kin'} <span className="optional">(optional)</span>
          </summary>
          <p className="identity-hint">Helps the clinic identify you correctly and reach someone on your behalf if needed.</p>
          <IdentityFields value={identity} onChange={setIdentity} />
        </details>
        {privacyAckRequired && (
          <label className="legal-check">
            <input type="checkbox" required checked={privacyAcknowledged} onChange={(e) => setPrivacyAcknowledged(e.target.checked)} />
            <span>
              I have read the ACISI{' '}
              <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer">
                Privacy Notice
              </a>{' '}
              and understand how my personal and health data will be used by {privacyClinicName || 'the clinic'} and ACISI.
            </span>
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button
          className="btn btn-primary"
          disabled={!departmentId || submitting || !legalBoxSatisfied(privacyAckRequired, privacyAcknowledged)}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Starting…' : 'Confirm check-in'}
        </button>
      </div>
    </>
  );
}

function BookAppointmentPanel({ patientCode }: { patientCode: string }) {
  const [clinics, setClinics] = useState<ClinicListItem[]>([]);
  const [clinicId, setClinicId] = useState('');
  const [departments, setDepartments] = useState<DepartmentListItem[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ departmentName: string; scheduledFor: string } | null>(null);

  useEffect(() => {
    api.listClinics().then((res) => {
      setClinics(res.clinics);
      if (res.clinics.length > 0) setClinicId(res.clinics[0]!.id);
    });
  }, []);

  useEffect(() => {
    setDepartmentId(null);
    setDepartments([]);
    if (!clinicId) return;

    let cancelled = false;
    api.getDepartmentsByClinic(clinicId).then((res) => {
      if (!cancelled) setDepartments(res.departments);
    });
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  async function handleSubmit(): Promise<void> {
    if (!clinicId || !departmentId || !scheduledFor) return;
    setError(null);
    setSubmitting(true);
    try {
      // datetime-local has no timezone info, so this is interpreted in the
      // browser's local time — the same clock the patient is reading the
      // input against.
      const asIso = new Date(scheduledFor).toISOString();
      await api.bookAppointment(clinicId, departmentId, asIso);
      const dept = departments.find((d) => d.id === departmentId);
      setConfirmed({ departmentName: dept?.name ?? '', scheduledFor });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="panel confirm">
        <div className="badge">
          <Check size={28} aria-hidden />
        </div>
        <h2>Appointment requested</h2>
        <p>{confirmed.departmentName}</p>
        <div className="patient-id">{patientCode}</div>
        <p>We&apos;ve sent your request to the clinic. Check &quot;My appointments&quot; for updates.</p>
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => {
            setConfirmed(null);
            setScheduledFor('');
          }}
        >
          Book another
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-h1">
        <CalendarPlus size={24} aria-hidden /> Book an appointment
      </h1>
      <p className="lede">Ask to be seen on a future date — this doesn&apos;t take today&apos;s place in the walk-in queue.</p>
      <div className="panel">
        <div className="field">
          <label htmlFor="book-clinic">Clinic</label>
          <select id="book-clinic" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Department</span>
          <div className="chip-row" role="group" aria-label="Department">
            {departments.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`chip ${departmentId === d.id ? 'selected' : ''}`}
                aria-pressed={departmentId === d.id}
                onClick={() => setDepartmentId(d.id)}
              >
                {departmentId === d.id && <Check size={15} aria-hidden />}
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="book-when">Date and time</label>
          <input
            id="book-when"
            type="datetime-local"
            value={scheduledFor}
            min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          className="btn btn-primary"
          disabled={!departmentId || !scheduledFor || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Requesting…' : 'Request appointment'}
        </button>
      </div>
    </>
  );
}

const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

function AppointmentsPanel() {
  const [appointments, setAppointments] = useState<OwnAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function refresh(): void {
    api.getMyAppointments().then((res) => setAppointments(res.appointments));
  }

  useEffect(refresh, []);

  async function handleCancel(id: string): Promise<void> {
    if (!confirm('Cancel this appointment?')) return;
    setCancellingId(id);
    setError(null);
    try {
      await api.cancelAppointment(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel appointment');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      <h1 className="page-h1">
        <CalendarCheck size={24} aria-hidden /> My appointments
      </h1>
      <p className="lede">Everything you&apos;ve requested, at any clinic.</p>
      <div className="panel">
        {error && <p className="error-text">{error}</p>}
        {appointments === null ? (
          <div className="skeleton-list" role="status" aria-label="Loading">
            <span />
            <span />
          </div>
        ) : appointments.length === 0 ? (
          <div className="empty">
            <CalendarClock size={26} aria-hidden />
            <p>No appointments booked yet.</p>
          </div>
        ) : (
          <div className="timeline">
            {appointments.map((a) => (
              <div className="t-entry" key={a.id}>
                <div className="t-date">
                  {new Date(a.scheduledFor).toLocaleString()}
                  <span className="t-dept">{a.departmentName}</span>
                </div>
                <div className="t-body">
                  <div className="t-head">
                    <b>
                      <Building2 size={15} aria-hidden /> {a.clinicName}
                    </b>
                    <span className={`pill tone-${STATUS_TONE[a.status] ?? 'neutral'}`}>
                      <span className="sr-only">Status: </span>
                      {APPOINTMENT_STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </div>
                  {(a.status === 'REQUESTED' || a.status === 'CONFIRMED') && (
                    <button
                      className="btn btn-secondary"
                      style={{ marginTop: 10 }}
                      disabled={cancellingId === a.id}
                      onClick={() => void handleCancel(a.id)}
                    >
                      {cancellingId === a.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RecordsPanel({ patientCode }: { patientCode: string }) {
  const [history, setHistory] = useState<VisitHistoryEntry[] | null>(null);

  useEffect(() => {
    api.getPatientRecords().then((res) => setHistory(res.history));
  }, []);

  return (
    <>
      <h1 className="page-h1">
        <FileText size={24} aria-hidden /> My records
      </h1>
      <p className="lede">
        Patient ID <strong>{patientCode}</strong> — every visit, in order.
      </p>
      <div className="panel">
        {history === null ? (
          <div className="skeleton-list" role="status" aria-label="Loading">
            <span />
            <span />
          </div>
        ) : history.length === 0 ? (
          <div className="empty">
            <FileText size={26} aria-hidden />
            <p>No visits on record yet.</p>
          </div>
        ) : (
          <div className="timeline">
            {history.map((h) => (
              <div className="t-entry" key={h.encounterId}>
                <div className="t-date">
                  {new Date(h.visitedAt).toLocaleDateString()}
                  <span className="t-dept">{h.departmentName}</span>
                </div>
                <div className="t-body">
                  <div className="t-head">
                    <b>
                      <Building2 size={15} aria-hidden /> {h.clinicName}
                    </b>
                    <span className="pill tone-success">Visit summary</span>
                  </div>
                  <p className="t-line">
                    <Stethoscope size={15} aria-hidden />
                    <span>
                      <b>Diagnosis / notes:</b> {h.diagnosis || 'Not recorded'}
                    </span>
                  </p>
                  <p className="t-line">
                    <Pill size={15} aria-hidden />
                    <span>
                      <b>Prescription:</b> {h.prescription || 'Not recorded'}
                    </span>
                  </p>
                  <a className="btn btn-secondary" style={{ marginTop: 12 }} href={api.recordDownloadUrl(h.encounterId)} download>
                    <Download size={16} aria-hidden /> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AccountPanel({ patientCode }: { patientCode: string }) {
  const { logout } = usePatientAuth();
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleDelete(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.deletePatientAccount(pin);
      setDeleted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (deleted) {
    return (
      <div className="panel">
        <div className="confirm">
          <div className="badge">
            <Check size={28} aria-hidden />
          </div>
          <h2>Your account has been deleted</h2>
          <p>Your personal details have been removed and you&apos;ve been logged out.</p>
          <p>We&apos;ve sent a confirmation SMS. You can register again any time.</p>
          <button className="btn btn-secondary" style={{ marginTop: 18 }} onClick={() => void logout()}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-h1">
        <UserRound size={24} aria-hidden /> Account
      </h1>
      <p className="lede">
        Patient ID <strong>{patientCode}</strong>
      </p>
      <div className="panel">
        <h2>Legal</h2>
        <p>How ACISI and your clinics use your data, and the terms you agreed to.</p>
        <p className="legal-links">
          <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer">
            Privacy Notice
          </a>
          <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>
        </p>
      </div>
      <div className="panel danger-panel">
        <h2>Delete my account</h2>
        <p>
          This permanently erases your name, phone number, email, date of birth and PIN, cancels any upcoming appointments, and
          logs you out on every device. It can&apos;t be undone.
        </p>
        <p>
          Clinics you&apos;ve visited keep a record of the visit (what was diagnosed and prescribed, and the payment), but with
          no name or phone number attached, so it can no longer be linked to you. If you want to use ACISI again later, just
          register as a new patient.
        </p>
        {!confirming ? (
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <form onSubmit={(e) => void handleDelete(e)}>
            <div className="field">
              <label htmlFor="delete-pin">Enter your PIN to confirm</label>
              <input
                id="delete-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-danger" disabled={!pin || submitting}>
                {submitting ? 'Deleting…' : 'Permanently delete my account'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submitting}
                onClick={() => {
                  setConfirming(false);
                  setPin('');
                  setError(null);
                }}
              >
                Keep my account
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
