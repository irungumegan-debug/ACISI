import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleCheckBig, MessageSquareText, Upload } from 'lucide-react';
import type { AddPatientResult } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AddPatientForm } from '../components/AddPatientForm';
import { btn } from '../components/ui';

export function AddPatientPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [result, setResult] = useState<AddPatientResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Add patient</h1>
          <p className="mt-1 text-sm text-ink-500">Register a patient at your clinic. They get their own ACISI ID.</p>
        </div>
        {session?.role === 'ADMIN' && (
          <Link to="/patients/import" className={btn.secondary}>
            <Upload size={16} aria-hidden /> Import a patient list
          </Link>
        )}
      </div>

      {result ? (
        <div className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div role="status" className="flex flex-col items-center rounded-2xl bg-emerald-50 px-4 py-6 text-center text-emerald-900">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
              <CircleCheckBig size={28} aria-hidden />
            </span>
            <p className="font-display text-lg font-semibold">{result.patient.name} added.</p>
            <p className="mt-1 text-sm">
              ACISI ID <strong className="font-mono">{result.patient.patientCode}</strong> — tell the patient to keep it safe.
            </p>
          </div>
          {result.sms === 'sent' && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-500">
              <MessageSquareText size={16} aria-hidden className="text-teal-700" /> Registration SMS sent.
            </p>
          )}
          {result.sms === 'failed' && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              The patient was added, but the registration SMS couldn&apos;t be sent.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className={`${btn.gold} flex-1`}
              onClick={() => {
                setResult(null);
                setFormKey((k) => k + 1);
              }}
            >
              Add another patient
            </button>
            <Link to={`/patients/${result.patient.id}`} className={`${btn.secondary} flex-1`}>
              Open patient
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card">
          <AddPatientForm
            key={formKey}
            onAdded={setResult}
            onPickExisting={(p) => navigate(p.linkedToClinic ? `/patients/${p.id}` : `/walk-in?q=${encodeURIComponent(p.patientCode)}`)}
          />
        </div>
      )}
    </div>
  );
}
