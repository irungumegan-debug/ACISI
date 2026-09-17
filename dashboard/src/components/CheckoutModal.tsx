import { FormEvent, useState } from 'react';
import { TodayQueueItem } from '../lib/api';

interface CheckoutModalProps {
  item: TodayQueueItem;
  onCancel: () => void;
  onSubmit: (input: { notes: string; prescription: string }) => Promise<void>;
}

export function CheckoutModal({ item, onCancel, onSubmit }: CheckoutModalProps) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [prescription, setPrescription] = useState(item.prescription ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ notes, prescription });
    } catch {
      setError('Could not complete checkout. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-navy-900">Check out {item.patientName}</h2>
        <p className="mb-4 text-sm text-slate-500">{item.departmentName}</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600" htmlFor="prescription">
              Prescription
            </label>
            <textarea
              id="prescription"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none"
              rows={3}
              placeholder="e.g. Amoxicillin 500mg, 3x daily for 5 days"
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600" htmlFor="notes">
              Visit notes / follow-up
            </label>
            <textarea
              id="notes"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none"
              rows={3}
              placeholder="Diagnosis, follow-up instructions, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-600 disabled:opacity-60"
            >
              {submitting ? 'Completing…' : 'Complete checkout & send SMS'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
