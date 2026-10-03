import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, Card, PageHeader } from '../components/ui';

/**
 * For a patient who asks to have their account deleted but can't do it
 * themselves from the portal. Works only from the patient ID they give you
 * — the owner site never looks up or displays who the patient is.
 */
export function DeletePatientPage() {
  const { handleExpired } = useAuth();
  const [code, setCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const normalized = code.trim().toUpperCase();
  const ready = /^ACI-[A-Z0-9]+$/.test(normalized) && confirmCode.trim().toUpperCase() === normalized;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setDone(null);
    setSubmitting(true);
    try {
      await api.deletePatient(normalized);
      setDone(normalized);
      setCode('');
      setConfirmCode('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleExpired();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Delete a patient account"
        subtitle="For a patient who asks you to delete their account. Patients can also do this themselves from the portal's Account tab."
      />
      <Card>
        <form onSubmit={(e) => void handleSubmit(e)} className="max-w-md space-y-4">
          <div className="space-y-2 text-sm text-stone-600">
            <p>
              Ask the patient for their <strong>patient ID</strong> (it starts with ACI-, e.g. ACI-7F2K). Deleting permanently erases
              their name, phone number, email, date of birth and PIN, cancels upcoming appointments, and logs them out. They get an SMS
              confirming it. This cannot be undone.
            </p>
            <p>Their visit and payment records stay with the clinics, with no name attached.</p>
          </div>
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-stone-700">
              Patient ID
            </label>
            <input
              id="code"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ACI-7F2K"
              className="w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm uppercase focus:border-stone-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-stone-700">
              Type the patient ID again to confirm
            </label>
            <input
              id="confirm"
              autoComplete="off"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm uppercase focus:border-stone-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Account {done} has been deleted. The patient has been sent a confirmation SMS.
            </p>
          )}
          <Button type="submit" tone="danger" disabled={!ready || submitting}>
            {submitting ? 'Deleting…' : 'Delete account permanently'}
          </Button>
        </form>
      </Card>
    </>
  );
}
