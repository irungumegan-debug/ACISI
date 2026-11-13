import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api, ApiError, LabTestItem } from '../lib/api';
import { Badge, btn, field } from './ui';

function wholeKes(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Settings → Lab tests: the tests this clinic's lab offers and their prices. Doctors pick from this list. */
export function LabTestsSection() {
  const [tests, setTests] = useState<LabTestItem[] | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; price: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listLabTestsForAdmin()
      .then((r) => setTests(r.tests))
      .catch(() => setError('Could not load the lab tests.'));

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    const priceKes = wholeKes(price);
    if (priceKes === null) {
      setError('Enter the price in whole shillings.');
      return;
    }
    if (await run(() => api.createLabTest({ name, priceKes }))) {
      setName('');
      setPrice('');
    }
  }

  async function saveEdit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!editing) return;
    const priceKes = wholeKes(editing.price);
    if (priceKes === null) {
      setError('Enter the price in whole shillings.');
      return;
    }
    if (await run(() => api.updateLabTest(editing.id, { name: editing.name, priceKes }))) setEditing(null);
  }

  return (
    <div>
      {tests === null && !error && <p className="text-sm text-ink-500">Loading…</p>}
      {tests && tests.length === 0 && <p className="mb-4 text-sm text-ink-500">No lab tests yet. Add the tests your lab offers below.</p>}
      {tests && tests.length > 0 && (
        <ul className="mb-5 divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
          {tests.map((t) =>
            editing?.id === t.id ? (
              <li key={t.id} className="p-3">
                <form onSubmit={(e) => void saveEdit(e)} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end">
                  <label className="block">
                    <span className={field.label}>Test</span>
                    <input className={field.input} value={editing.name} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className={field.label}>Price (KES)</span>
                    <input className={field.input} inputMode="numeric" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} />
                  </label>
                  <button type="submit" className={btn.gold} disabled={busy}>
                    Save
                  </button>
                  <button type="button" className={btn.secondary} disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`flex-1 font-medium ${t.isActive ? 'text-navy-900' : 'text-ink-400 line-through'}`}>{t.name}</span>
                <span className="text-sm text-ink-700">KES {t.priceKes.toLocaleString('en-KE')}</span>
                {!t.isActive && <Badge tone="neutral">Not offered</Badge>}
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={busy}
                  onClick={() => setEditing({ id: t.id, name: t.name, price: String(t.priceKes) })}
                  aria-label={`Edit ${t.name}`}
                >
                  <Pencil size={14} aria-hidden /> Edit
                </button>
                <button type="button" className={btn.ghost} disabled={busy} onClick={() => void run(() => api.updateLabTest(t.id, { isActive: !t.isActive }))}>
                  {t.isActive ? 'Stop offering' : 'Offer again'}
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <form onSubmit={(e) => void add(e)} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <label className="block">
          <span className={field.label}>New test</span>
          <input className={field.input} placeholder="e.g. Malaria RDT" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className={field.label}>Price (KES)</span>
          <input className={field.input} inputMode="numeric" placeholder="300" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <button type="submit" className={btn.gold} disabled={busy || name.trim().length < 2 || !price.trim()}>
          <Plus size={16} aria-hidden /> Add test
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
