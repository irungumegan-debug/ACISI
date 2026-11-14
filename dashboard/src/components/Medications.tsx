import { useState } from 'react';
import { ChevronDown, Pill } from 'lucide-react';
import { MedicationItem } from '../lib/api';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

/** Current medicines (course not finished) and the full medication history, from the visits the doctor may see. */
export function Medications({ items }: { items: MedicationItem[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const current = items.filter((m) => m.active);
  return (
    <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card" aria-label="Medicines">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-700">
        <Pill size={16} aria-hidden className="text-gold-700" /> Current medicines
      </h2>
      {current.length === 0 ? (
        <p className="text-sm text-ink-500">None recorded in the visits you can see.</p>
      ) : (
        <ul className="space-y-2">
          {current.map((m) => (
            <li key={m.id} className="text-sm text-ink-700">
              {m.text}
              <span className="block text-xs text-ink-500">
                {date(m.prescribedAt)} · {m.clinicName}
                {m.prescribedBy ? ` · ${m.prescribedBy}` : ''}
                {m.endsOn ? ` · until ${date(m.endsOn)}` : ''}
              </span>
              {m.allergyOverrideReason && <span className="block text-xs font-semibold text-red-700">Prescribed despite an allergy: {m.allergyOverrideReason}</span>}
            </li>
          ))}
        </ul>
      )}
      {items.length > current.length && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-navy-900 hover:underline"
          >
            <ChevronDown size={15} aria-hidden className={showHistory ? 'rotate-180' : ''} /> Medication history ({items.length - current.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-2 border-t border-slate-100 pt-2">
              {items
                .filter((m) => !m.active)
                .map((m) => (
                  <li key={m.id} className="text-sm text-ink-500">
                    {m.text}
                    <span className="block text-xs">
                      {date(m.prescribedAt)} · {m.clinicName}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
