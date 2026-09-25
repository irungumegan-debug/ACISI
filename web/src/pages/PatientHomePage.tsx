import { useEffect, useState } from 'react';
import { api, ApiError, ClinicListItem, DepartmentListItem, OwnAppointment, VisitHistoryEntry } from '../lib/api';
import { usePatientAuth } from '../context/PatientAuthContext';

type Tab = 'checkin' | 'book' | 'appointments' | 'records';

export function PatientHomePage() {
  const { session } = usePatientAuth();
  const [tab, setTab] = useState<Tab>('checkin');

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'checkin' ? 'active' : ''}`} onClick={() => setTab('checkin')}>
          Check in
        </button>
        <button className={`tab ${tab === 'book' ? 'active' : ''}`} onClick={() => setTab('book')}>
          Book appointment
        </button>
        <button className={`tab ${tab === 'appointments' ? 'active' : ''}`} onClick={() => setTab('appointments')}>
          My appointments
        </button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>
          My records
        </button>
      </div>

      {tab === 'checkin' && <CheckInPanel patientCode={session?.patientCode ?? ''} />}
      {tab === 'book' && <BookAppointmentPanel patientCode={session?.patientCode ?? ''} />}
      {tab === 'appointments' && <AppointmentsPanel />}
      {tab === 'records' && <RecordsPanel patientCode={session?.patientCode ?? ''} />}
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
  const [confirmed, setConfirmed] = useState<{ departmentName: string } | null>(null);

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
    if (!clinicId || !departmentId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.patientCheckIn(clinicId, departmentId);
      if (res.status === 'FAILED') {
        setError('We could not start the payment request. Please try again shortly.');
        return;
      }
      const dept = departments.find((d) => d.id === departmentId);
      setConfirmed({ departmentName: dept?.name ?? '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="panel confirm">
        <div className="badge">&#10003;</div>
        <h2>Check your phone</h2>
        <p>{confirmed.departmentName}</p>
        <div className="patient-id">{patientCode}</div>
        <p>We&apos;ve sent an M-Pesa prompt to your phone. Enter your M-Pesa PIN to complete check-in.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setConfirmed(null)}>
          Check in again
        </button>
      </div>
    );
  }

  return (
    <>
      <h1>Check in</h1>
      <p className="lede">Tell us where you&apos;re headed. This is the same check-in a USSD dial-in triggers, on a browser.</p>
      <div className="panel">
        <div className="field">
          <label>Clinic</label>
          <select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <div className="chip-row">
            {departments.map((d) => (
              <div
                key={d.id}
                className={`chip ${departmentId === d.id ? 'selected' : ''}`}
                onClick={() => setDepartmentId(d.id)}
              >
                {d.name}
              </div>
            ))}
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" disabled={!departmentId || submitting} onClick={() => void handleSubmit()}>
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
        <div className="badge">&#10003;</div>
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
      <h1>Book an appointment</h1>
      <p className="lede">Ask to be seen on a future date — this doesn&apos;t take today&apos;s place in the walk-in queue.</p>
      <div className="panel">
        <div className="field">
          <label>Clinic</label>
          <select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <div className="chip-row">
            {departments.map((d) => (
              <div
                key={d.id}
                className={`chip ${departmentId === d.id ? 'selected' : ''}`}
                onClick={() => setDepartmentId(d.id)}
              >
                {d.name}
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Date and time</label>
          <input
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
      <h1>My appointments</h1>
      <p className="lede">Everything you&apos;ve requested, at any clinic.</p>
      <div className="panel">
        {error && <p className="error-text">{error}</p>}
        {appointments === null ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>Loading…</p>
        ) : appointments.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>No appointments booked yet.</p>
        ) : (
          <div className="timeline">
            {appointments.map((a) => (
              <div className="t-entry" key={a.id}>
                <div className="t-date">
                  {new Date(a.scheduledFor).toLocaleString()}
                  <span className="t-dept">{a.departmentName}</span>
                </div>
                <div className="t-body">
                  <b>{a.clinicName}</b>
                  <p style={{ margin: '6px 0 0' }}>
                    <b>Status:</b> {APPOINTMENT_STATUS_LABEL[a.status] ?? a.status}
                  </p>
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
      <h1>My records</h1>
      <p className="lede">
        Patient ID <strong>{patientCode}</strong> — every visit, in order.
      </p>
      <div className="panel">
        {history === null ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>No visits on record yet.</p>
        ) : (
          <div className="timeline">
            {history.map((h) => (
              <div className="t-entry" key={h.encounterId}>
                <div className="t-date">
                  {new Date(h.visitedAt).toLocaleDateString()}
                  <span className="t-dept">{h.departmentName}</span>
                </div>
                <div className="t-body">
                  <b>{h.clinicName}</b>
                  <p style={{ margin: '6px 0 0' }}>
                    <b>Diagnosis / notes:</b> {h.diagnosis || 'Not recorded'}
                  </p>
                  <p style={{ margin: '4px 0 0' }}>
                    <b>Prescription:</b> {h.prescription || 'Not recorded'}
                  </p>
                  <a className="btn btn-secondary" style={{ marginTop: 10 }} href={api.recordDownloadUrl(h.encounterId)} download>
                    Download
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
