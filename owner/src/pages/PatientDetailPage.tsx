import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, PatientDetail } from '../lib/api';
import { formatDate, formatDateTime, formatKes, humanize } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { Badge, Button, Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';
import { DeletedBadge, EncounterBadge } from '../components/StatusBadges';
import { ActivityList } from '../components/ActivityList';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-stone-900">{value}</dd>
    </div>
  );
}

function DeletePatient({ patient, onDeleted }: { patient: PatientDetail; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const matches = typed.trim().toUpperCase() === patient.patientCode;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.deletePatient(patient.id, typed);
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button tone="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-stone-900/60 px-4" role="dialog" aria-modal="true">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-stone-900">
          Delete {patient.firstName} {patient.lastName}'s account?
        </h2>
        <div className="mt-3 space-y-2 text-sm text-stone-600">
          <p>
            Their name, phone number, email, date of birth, county and PIN will be <strong>permanently erased</strong>, and
            they'll be logged out everywhere. This cannot be undone.
          </p>
          <p>
            Their {patient.visits.length} visit{patient.visits.length === 1 ? '' : 's'} and payment records are kept, with no
            name attached, so clinics keep their medical and financial records. Open appointments are cancelled. They'll get
            an SMS confirming the deletion.
          </p>
        </div>
        <label className="mt-4 block text-sm font-medium text-stone-700" htmlFor="confirm">
          Type <span className="font-mono">{patient.patientCode}</span> to confirm
        </label>
        <input
          id="confirm"
          autoFocus
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm uppercase focus:border-stone-500 focus:outline-none"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" tone="danger" disabled={!matches || submitting}>
            {submitting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const { data: patient, error, loading, reload } = useLoad(() => api.patient(id), [id]);

  if (loading && !patient) return <Loading />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!patient) return null;

  const deleted = patient.deletedAt !== null;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/patients" className="text-stone-500 hover:text-stone-900">
          ← All patients
        </Link>
      </p>
      <PageHeader
        title={`${patient.firstName} ${patient.lastName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{patient.patientCode}</span>
            {deleted && <DeletedBadge />}
            <span>· Registered {formatDate(patient.createdAt)}</span>
          </span>
        }
        actions={!deleted && <DeletePatient patient={patient} onDeleted={reload} />}
      />

      {deleted && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This account was deleted on {formatDateTime(patient.deletedAt)} by{' '}
          {patient.deletedByType === 'OWNER' ? 'the platform owner' : 'the patient'}. Their personal details have been erased;
          the visit records below are kept anonymously.
        </div>
      )}

      <div className="space-y-6">
        <Card title="Profile">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Phone" value={patient.phoneNumber ?? '—'} />
            <Field label="Email" value={patient.email ?? '—'} />
            <Field label="Date of birth" value={formatDate(patient.dateOfBirth)} />
            <Field label="Sex" value={humanize(patient.sex)} />
            <Field label="County" value={patient.county ?? '—'} />
            <Field label="Portal PIN" value={patient.hasPin ? 'Set' : 'Not set'} />
            <Field label="Shares records across clinics" value={patient.crossClinicSharing ? 'Yes' : 'No'} />
          </dl>
        </Card>

        <Card title={`Visits (${patient.visits.length})`}>
          {patient.visits.length === 0 ? (
            <Empty>No visits yet.</Empty>
          ) : (
            <ul className="space-y-4">
              {patient.visits.map((v) => (
                <li key={v.encounterId} className="rounded-md border border-stone-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      <Link to={`/clinics/${v.clinicId}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                        {v.clinicName}
                      </Link>
                      <span className="text-stone-500"> · {v.departmentName}</span>
                    </p>
                    <span className="flex items-center gap-2 text-xs text-stone-500">
                      {formatDateTime(v.visitedAt)} <EncounterBadge status={v.status} />
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Diagnosis" value={v.diagnosis ?? '—'} />
                    <Field label="Prescription" value={v.prescription ?? '—'} />
                    {v.visitReason && <Field label="Reason for visit" value={v.visitReason} />}
                    <Field label="Doctor" value={v.consultedByName ?? v.assignedDoctorName ?? '—'} />
                    <Field
                      label="Payment"
                      value={`${formatKes(v.amountKes)} · ${humanize(v.paymentStatus)}${v.mpesaReceiptNumber ? ` · ${v.mpesaReceiptNumber}` : ''}`}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Appointments (${patient.appointments.length})`}>
          {patient.appointments.length === 0 ? (
            <Empty>No appointments.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100">
              {patient.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium text-stone-900">{a.clinicName}</span>
                    <span className="text-stone-500"> · {a.departmentName}</span>
                  </span>
                  <span className="flex items-center gap-2 text-stone-500">
                    {formatDateTime(a.scheduledFor)} <Badge tone="stone">{humanize(a.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Consent history">
          {patient.consents.length === 0 ? (
            <Empty>No consent records.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100">
              {patient.consents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {humanize(c.type)} <span className="text-stone-500">via {humanize(c.channel)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-stone-500">
                    {formatDateTime(c.createdAt)}
                    <Badge tone={c.granted ? 'green' : 'stone'}>{c.granted ? 'Granted' : 'Declined / withdrawn'}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Who has accessed this record">
          <p className="mb-2 text-xs text-stone-500">The 50 most recent entries, including your own views.</p>
          {patient.accessLog.length === 0 ? <Empty>No access recorded.</Empty> : <ActivityList entries={patient.accessLog} showEntity={false} />}
        </Card>
      </div>
    </>
  );
}
