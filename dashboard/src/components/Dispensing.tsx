import { useEffect, useState } from 'react';
import { Pill } from 'lucide-react';
import { api, ApiError, DispenseLine } from '../lib/api';
import { Badge, btn, Card } from './ui';

/** Checkout: for each prescribed medicine, record whether the clinic gave it (and how much) or the patient will buy it elsewhere. */
export function Dispensing({ encounterId }: { encounterId: string }) {
  const [items, setItems] = useState<DispenseLine[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDispensing(encounterId)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [encounterId]);

  async function record(item: DispenseLine, status: 'DISPENSED' | 'NOT_DISPENSED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const typed = qty[item.id];
      setItems((await api.recordDispensing(encounterId, item.id, status, status === 'DISPENSED' && typed ? Number(typed) : null)).items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <Card title="Dispensing" icon={Pill} className="print:hidden">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-navy-900">{i.text}</p>
              {i.dispenseStatus === 'DISPENSED' && (
                <p className="text-xs text-ink-500">
                  Given: {i.dispensedQuantity} {i.unit}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {i.dispenseStatus && <Badge tone={i.dispenseStatus === 'DISPENSED' ? 'success' : 'neutral'}>{i.dispenseStatus === 'DISPENSED' ? 'Given' : 'Buying elsewhere'}</Badge>}
              <label className="sr-only" htmlFor={`qty-${i.id}`}>
                Quantity given
              </label>
              <input
                id={`qty-${i.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                className="min-h-9 w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                placeholder={i.prescribedQuantity ? String(i.prescribedQuantity) : 'Qty'}
                value={qty[i.id] ?? ''}
                onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
              />
              <span className="text-xs text-ink-500">{i.unit}</span>
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => void record(i, 'DISPENSED')}>
                Given
              </button>
              <button type="button" className={btn.ghost} disabled={busy} onClick={() => void record(i, 'NOT_DISPENSED')}>
                Buying elsewhere
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">Leave the quantity empty to use the prescribed amount. Recording again corrects it.</p>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
