import { FormEvent, useState } from 'react';
import { AlertTriangle, History, Plus, X } from 'lucide-react';
import { AllergyCategory, AllergyItem, AllergySeverity, api, ApiError } from '../lib/api';
import { Badge, btn, field } from './ui';

const CATEGORY_LABEL: Record<AllergyCategory, string> = { MEDICATION: 'Medicine', FOOD: 'Food', ENVIRONMENT: 'Environment', OTHER: 'Other' };
const SEVERITY_LABEL: Record<AllergySeverity, string> = { MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe', UNKNOWN: 'Severity unknown' };
const SEVERITY_TONE: Record<AllergySeverity, 'warning' | 'danger' | 'neutral'> = { MILD: 'warning', MODERATE: 'warning', SEVERE: 'danger', UNKNOWN: 'neutral' };

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Allergies on the consultation page: a red banner with the current ones
 * (always visible), a form to record one, and the full history including
 * removed ones. Removing needs a reason and never deletes anything.
 */
export function Allergies({
  encounterId,
  initial,
  hiddenElsewhere,
}: {
  encounterId: string;
  initial: AllergyItem[];
  hiddenElsewhere: boolean;
}) {
  const [items, setItems] = useState<AllergyItem[]>(initial);
  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [category, setCategory] = useState<AllergyCategory>('MEDICATION');
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<AllergySeverity>('UNKNOWN');
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = items.filter((a) => !a.removedAt);
  const removed = items.filter((a) => a.removedAt);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.recordAllergy(encounterId, { category, substance, reaction, severity });
      setItems([a, ...items]);
      setAdding(false);
      setSubstance('');
      setReaction('');
      setSeverity('UNKNOWN');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: FormEvent, id: string): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.removeAllergy(encounterId, id, reason);
      setItems(items.map((x) => (x.id === id ? a : x)));
      setRemoving(null);
      setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Allergies"
      className={`mb-6 rounded-2xl p-4 shadow-card ring-1 sm:p-5 ${current.length > 0 ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-200'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`flex items-center gap-2 font-display text-lg font-semibold ${current.length > 0 ? 'text-red-800' : 'text-navy-900'}`}>
          <AlertTriangle size={18} aria-hidden /> {current.length > 0 ? `Allergies (${current.length})` : 'No known allergies recorded'}
        </h2>
        <div className="flex gap-2">
          {removed.length > 0 && (
            <button type="button" className={btn.ghost} onClick={() => setShowHistory(!showHistory)}>
              <History size={14} aria-hidden /> {showHistory ? 'Hide history' : `History (${removed.length} removed)`}
            </button>
          )}
          {!adding && (
            <button type="button" className={btn.ghost} onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden /> Record an allergy
            </button>
          )}
        </div>
      </div>

      {current.length > 0 && (
        <ul className="mt-3 space-y-2">
          {current.map((a) => (
            <li key={a.id} className="rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-red-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-navy-900">{a.substance}</span>
                <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Badge>
                <span className="text-xs text-ink-500">{CATEGORY_LABEL[a.category]}</span>
                {a.isOwnClinic && removing !== a.id && (
                  <button type="button" className="ml-auto text-xs font-medium text-ink-500 underline-offset-2 hover:underline" onClick={() => setRemoving(a.id)}>
                    Remove
                  </button>
                )}
              </div>
              {a.reaction && <p className="mt-0.5 text-sm text-ink-700">Reaction: {a.reaction}</p>}
              <p className="mt-0.5 text-xs text-ink-500">
                Recorded {fmt(a.recordedAt)} by {a.recordedByName}
                {!a.isOwnClinic && ` at ${a.clinicName} (shared)`}
              </p>
              {removing === a.id && (
                <form onSubmit={(e) => void remove(e, a.id)} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input className={field.input} placeholder="Why remove it? (e.g. recorded in error)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="submit" className={btn.danger} disabled={busy || reason.trim().length < 3}>
                    Remove
                  </button>
                  <button type="button" className={btn.secondary} onClick={() => setRemoving(null)}>
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {hiddenElsewhere && (
        <p className="mt-3 text-xs text-ink-500">Other clinics have recorded allergies that are hidden because the patient hasn&apos;t allowed sharing. Ask the patient.</p>
      )}

      {adding && (
        <form onSubmit={(e) => void add(e)} className="mt-3 space-y-3 rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-navy-900">Record an allergy</p>
            <button type="button" aria-label="Close" className="rounded-full p-1 text-ink-500 hover:bg-slate-100" onClick={() => setAdding(false)}>
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={field.label}>Substance</span>
              <input className={field.input} required maxLength={120} placeholder="e.g. Penicillin" value={substance} onChange={(e) => setSubstance(e.target.value)} />
            </label>
            <label className="block">
              <span className={field.label}>Type</span>
              <select className={field.input} value={category} onChange={(e) => setCategory(e.target.value as AllergyCategory)}>
                {(Object.keys(CATEGORY_LABEL) as AllergyCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={field.label}>Reaction (optional)</span>
              <input className={field.input} maxLength={120} placeholder="e.g. Rash, swelling" value={reaction} onChange={(e) => setReaction(e.target.value)} />
            </label>
            <label className="block">
              <span className={field.label}>Severity</span>
              <select className={field.input} value={severity} onChange={(e) => setSeverity(e.target.value as AllergySeverity)}>
                {(Object.keys(SEVERITY_LABEL) as AllergySeverity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className={btn.gold} disabled={busy || substance.trim().length < 2}>
            {busy ? 'Saving…' : 'Save allergy'}
          </button>
        </form>
      )}

      {showHistory && removed.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm text-ink-500">
          {removed.map((a) => (
            <li key={a.id}>
              <span className="line-through">{a.substance}</span> ({SEVERITY_LABEL[a.severity].toLowerCase()}): recorded {fmt(a.recordedAt)} by {a.recordedByName}; removed{' '}
              {a.removedAt && fmt(a.removedAt)} by {a.removedByName}: {a.removedReason}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
