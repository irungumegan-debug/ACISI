import { FormEvent, useEffect, useState } from 'react';
import { ClipboardPlus } from 'lucide-react';
import { api, ApiError, ServiceOrderCategory, ServiceOrderItem } from '../lib/api';
import { Badge, btn, Card, field } from './ui';

const CATEGORIES: { value: ServiceOrderCategory; label: string; example: string }[] = [
  { value: 'RADIOLOGY', label: 'Radiology / imaging', example: 'e.g. Chest X-ray PA, abdominal ultrasound' },
  { value: 'PHYSIOTHERAPY', label: 'Physiotherapy', example: 'e.g. Lower back physiotherapy, 6 sessions' },
  { value: 'OCCUPATIONAL_THERAPY', label: 'Occupational therapy', example: 'e.g. Hand function assessment' },
  { value: 'NUTRITION', label: 'Nutrition / dietetics', example: 'e.g. Diabetic diet review' },
  { value: 'SOCIAL_WORK', label: 'Social work', example: 'e.g. Support with NHIF/SHA registration' },
  { value: 'COUNSELLING', label: 'Counselling', example: 'e.g. HIV pre-test counselling' },
];

const STATUS_LABEL: Record<ServiceOrderItem['status'], string> = { REQUESTED: 'To arrange', DONE: 'Done / referred', CANCELLED: 'Cancelled' };
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

function OrderRow({ o, actions }: { o: ServiceOrderItem; actions?: React.ReactNode }) {
  return (
    <li className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between ${o.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
      <div className="min-w-0 text-sm">
        <p className="text-xs font-semibold uppercase text-gold-700">
          {o.categoryLabel}
          {o.urgent && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-red-700">Urgent</span>}
        </p>
        <p className={`font-medium text-navy-900 ${o.status === 'CANCELLED' ? 'line-through' : ''}`}>{o.description}</p>
        {o.note && <p className="text-ink-700">{o.note}</p>}
        <p className="text-xs text-ink-500">By {o.requestedByName}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge tone={o.status === 'DONE' ? 'success' : o.status === 'CANCELLED' ? 'neutral' : 'warning'}>{STATUS_LABEL[o.status]}</Badge>
        {actions}
      </div>
    </li>
  );
}

/** Doctor, during the consultation: place radiology, therapy, nutrition, social work and counselling orders. */
export function ServiceOrdersEditor({ encounterId, initial, editable }: { encounterId: string; initial: ServiceOrderItem[]; editable: boolean }) {
  const [orders, setOrders] = useState(initial);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ServiceOrderCategory>('RADIOLOGY');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOrders((await api.addServiceOrder(encounterId, { category, description, note: note || undefined, urgent })).orders);
      setDescription('');
      setNote('');
      setUrgent(false);
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string): Promise<void> {
    if (!confirm('Cancel this order? It stays on the visit, marked cancelled.')) return;
    setBusy(true);
    setError(null);
    try {
      setOrders((await api.cancelServiceOrder(encounterId, id)).orders);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editable && orders.length === 0) return null;
  const example = CATEGORIES.find((c) => c.value === category)?.example;

  return (
    <Card
      title="Other orders"
      icon={ClipboardPlus}
      className="mb-6"
      actions={
        editable && !open ? (
          <button type="button" className={btn.ghost} onClick={() => setOpen(true)}>
            + Add order
          </button>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-ink-500">Radiology, physiotherapy, occupational therapy, nutrition, social work, counselling. Front desk arranges them at checkout.</p>
      {orders.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              o={o}
              actions={
                editable && o.status === 'REQUESTED' ? (
                  <button type="button" className={btn.ghost} disabled={busy} onClick={() => void cancel(o.id)}>
                    Cancel
                  </button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
      {editable && open && (
        <form onSubmit={(e) => void add(e)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <div>
              <label className={field.label} htmlFor="orderCategory">Type</label>
              <select id="orderCategory" className={field.input} value={category} onChange={(e) => setCategory(e.target.value as ServiceOrderCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={field.label} htmlFor="orderDescription">What is ordered</label>
              <input id="orderDescription" className={field.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={example} required maxLength={200} />
            </div>
          </div>
          <div>
            <label className={field.label} htmlFor="orderNote">Reason / instructions (optional)</label>
            <input id="orderNote" className={field.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-5 w-5 accent-navy-900" />
            Urgent
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btn.primary} disabled={busy || !description.trim()}>
              {busy ? 'Adding…' : 'Add order'}
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

/** Front desk at checkout: the visit's orders to arrange; mark each done (done here, referred or booked) or not needed. */
export function ServiceOrdersToArrange({ encounterId }: { encounterId: string }) {
  const [orders, setOrders] = useState<ServiceOrderItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getVisitServiceOrders(encounterId)
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  }, [encounterId]);

  async function close(id: string, outcome: 'DONE' | 'CANCELLED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setOrders((await api.closeVisitServiceOrder(encounterId, id, outcome)).orders);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!orders || orders.length === 0) return null;

  return (
    <Card title="Orders to arrange" icon={ClipboardPlus} className="print:hidden">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {orders.map((o) => (
          <OrderRow
            key={o.id}
            o={o}
            actions={
              o.status === 'REQUESTED' ? (
                <>
                  <button type="button" className={btn.secondary} disabled={busy} onClick={() => void close(o.id, 'DONE')}>
                    Done / referred
                  </button>
                  <button type="button" className={btn.ghost} disabled={busy} onClick={() => void close(o.id, 'CANCELLED')}>
                    Not needed
                  </button>
                </>
              ) : undefined
            }
          />
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">Add any charge for these to the bill.</p>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
