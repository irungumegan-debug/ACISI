import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  BillItem,
  BillItemKind,
  BillStatus,
  CheckoutPayment,
  CheckoutView,
  newIdempotencyKey,
  PaymentMethod,
  PaymentStatus,
} from '../lib/api';
import { useAuth } from '../context/AuthContext';

const input = 'w-full rounded-md border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none';
const label = 'mb-1 block text-sm font-medium text-slate-700';
const primaryBtn = 'rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';
const secondaryBtn = 'rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50';

export function kes(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

/** Whole KES from a text box: digits only, or null. */
function parseKes(text: string): number | null {
  const t = text.replace(/[,\s]/g, '');
  return /^\d{1,8}$/.test(t) ? Number(t) : null;
}

const KIND_LABEL: Record<BillItemKind, string> = { CONSULTATION: 'Consultation', LAB: 'Lab test', MEDICATION: 'Medication', OTHER: 'Other' };
const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: 'Cash', CARD: 'Card', MPESA_STK: 'M-Pesa request', MPESA_MANUAL: 'M-Pesa code' };
const PAYMENT_STATUS: Record<PaymentStatus, { label: string; className: string }> = {
  PENDING: { label: 'Waiting for patient', className: 'bg-amber-100 text-amber-800' },
  SUCCEEDED: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800' },
  FAILED: { label: 'Failed', className: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'Cancelled by patient', className: 'bg-red-100 text-red-800' },
  TIMED_OUT: { label: 'Timed out', className: 'bg-slate-200 text-slate-700' },
  VOIDED: { label: 'Voided', className: 'bg-slate-100 text-slate-500' },
};

export function BillStatusChip({ status }: { status: BillStatus | null }) {
  const map: Record<BillStatus | 'NONE', { label: string; className: string }> = {
    NONE: { label: 'No bill yet', className: 'bg-slate-100 text-slate-600' },
    UNPAID: { label: 'Unpaid', className: 'bg-red-100 text-red-800' },
    PARTLY_PAID: { label: 'Partly paid', className: 'bg-amber-100 text-amber-800' },
    PAID: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800' },
  };
  const s = map[status ?? 'NONE'];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

interface DraftLine {
  kind: BillItemKind;
  description: string;
  amount: string;
}

function toDraft(items: BillItem[]): DraftLine[] {
  return items.map((i) => ({ kind: i.kind, description: i.description, amount: String(i.amountKes) }));
}

// --- Bill editor ---------------------------------------------------------------

function BillEditor({ view, onSaved, onCancel }: { view: CheckoutView; onSaved: (v: CheckoutView) => void; onCancel?: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    view.bill
      ? toDraft(view.bill.items)
      : [{ kind: 'CONSULTATION', description: 'Consultation', amount: String(view.settings.defaultConsultationFeeKes || '') }],
  );
  const [discount, setDiscount] = useState(view.bill?.discountKes ? String(view.bill.discountKes) : '');
  const [discountReason, setDiscountReason] = useState(view.bill?.discountReason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amounts = lines.map((l) => parseKes(l.amount));
  const subtotal = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const discountKes = discount.trim() ? parseKes(discount) : 0;
  const total = subtotal - (discountKes ?? 0);
  const valid =
    lines.length > 0 &&
    lines.every((l, i) => l.description.trim() && amounts[i] !== null) &&
    discountKes !== null &&
    discountKes <= subtotal &&
    (discountKes === 0 || discountReason.trim().length > 0);

  function update(i: number, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveBill(view.encounterId, {
        items: lines.map((l, i) => ({ kind: l.kind, description: l.description.trim(), amountKes: amounts[i] as number })),
        discountKes: discountKes ?? 0,
        discountReason: discountKes ? discountReason.trim() : null,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the bill. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4">
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[9rem_1fr_8rem_auto] sm:items-center sm:border-0 sm:p-0">
            <select
              aria-label="Item type"
              value={line.kind}
              onChange={(e) => update(i, { kind: e.target.value as BillItemKind })}
              className={`${input} col-span-2 sm:col-span-1`}
            >
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="Description"
              value={line.description}
              maxLength={100}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Description, e.g. Malaria test"
              className={`${input} col-span-2 sm:col-span-1`}
            />
            <input
              aria-label="Amount in KES"
              inputMode="numeric"
              value={line.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              placeholder="KES"
              className={`${input} ${line.amount && amounts[i] === null ? 'border-red-400' : ''}`}
            />
            <button
              type="button"
              aria-label="Remove item"
              onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
              disabled={lines.length === 1}
              className="h-10 w-10 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {(['LAB', 'MEDICATION', 'OTHER'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setLines((prev) => [...prev, { kind, description: '', amount: '' }])}
            className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-500"
          >
            + {KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <label htmlFor="discount" className={label}>
            Discount
          </label>
          <input id="discount" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="KES" className={input} />
        </div>
        {discountKes !== 0 && (
          <div>
            <label htmlFor="discountReason" className={label}>
              Reason for discount (required)
            </label>
            <input
              id="discountReason"
              value={discountReason}
              maxLength={200}
              onChange={(e) => setDiscountReason(e.target.value)}
              placeholder="e.g. Returning patient, staff family"
              className={input}
            />
          </div>
        )}
      </div>

      <div className="rounded-md bg-slate-50 p-4">
        <div className="flex justify-between text-sm text-slate-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{kes(subtotal)}</span>
        </div>
        {discountKes ? (
          <div className="flex justify-between text-sm text-slate-600">
            <span>Discount</span>
            <span className="tabular-nums">− {kes(discountKes)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-2">
          <span className="font-semibold text-slate-900">Total</span>
          <span className="text-2xl font-bold tabular-nums text-slate-900">{kes(Math.max(total, 0))}</span>
        </div>
        {discountKes !== null && discountKes > subtotal && <p className="mt-1 text-sm text-red-600">The discount can't be more than the subtotal.</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryBtn}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving || !valid} className={primaryBtn}>
          {saving ? 'Saving…' : view.bill ? 'Save changes' : 'Save bill'}
        </button>
      </div>
    </form>
  );
}

// --- Taking payment ----------------------------------------------------------------

function PaymentPanel({ view, onChanged }: { view: CheckoutView; onChanged: () => Promise<void> }) {
  const bill = view.bill!;
  const s = view.settings;
  const methods = useMemo(
    () => [
      ...(s.acceptsCash ? (['cash'] as const) : []),
      ...(s.acceptsCard ? (['card'] as const) : []),
      ...(s.acceptsMobileMoney ? (['mpesa'] as const) : []),
    ],
    [s],
  );
  const [tab, setTab] = useState<'cash' | 'card' | 'mpesa'>(methods[0] ?? 'cash');
  const [amount, setAmount] = useState(String(bill.balanceKes));
  const [tendered, setTendered] = useState('');
  const [cardRef, setCardRef] = useState('');
  const [mpesaCode, setMpesaCode] = useState('');
  const [phone, setPhone] = useState(view.patient.phoneNumber);
  const [showManualCode, setShowManualCode] = useState(!s.stkAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per attempt: a double click or a retry after a dropped
  // connection resends the same key, so the server records it only once.
  const attemptKey = useRef(newIdempotencyKey());

  useEffect(() => {
    setAmount(String(bill.balanceKes));
  }, [bill.balanceKes]);

  const pending = view.payments.find((p) => p.status === 'PENDING');
  const lastStk = [...view.payments].reverse().find((p) => p.method === 'MPESA_STK');
  const amountKes = parseKes(amount);
  const tenderedKes = parseKes(tendered);
  const change = tenderedKes !== null ? Math.max(tenderedKes - bill.balanceKes, 0) : null;

  async function run(action: () => Promise<string | null>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      attemptKey.current = newIdempotencyKey();
      setTendered('');
      setCardRef('');
      setMpesaCode('');
      setNotice(message);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (methods.length === 0) {
    return <p className="text-sm text-slate-600">This clinic hasn&apos;t chosen any payment methods yet. An admin can set them in Settings.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex w-full rounded-md border border-slate-300 p-0.5 text-sm sm:w-auto">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setTab(m)}
            className={`flex-1 rounded px-4 py-2 sm:flex-none ${tab === m ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
          >
            {m === 'cash' ? 'Cash' : m === 'card' ? 'Card' : 'M-Pesa'}
          </button>
        ))}
      </div>

      {pending && tab !== 'mpesa' && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">An M-Pesa request is waiting for the patient. Other payments are paused until it finishes.</p>
      )}

      {tab === 'cash' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tenderedKes === null || tenderedKes < 1) return;
            void run(async () => {
              const res = await api.recordPayment(bill.id, { method: 'CASH', tenderedKes, idempotencyKey: attemptKey.current });
              return res.changeKes ? `Cash recorded. Give change: ${kes(res.changeKes)}.` : 'Cash recorded.';
            });
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="tendered" className={label}>
              Amount received (balance {kes(bill.balanceKes)})
            </label>
            <input id="tendered" inputMode="numeric" autoComplete="off" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="KES" className={input} />
          </div>
          {change !== null && (
            <p className="text-lg font-semibold text-slate-900">
              Change due: <span className="tabular-nums">{kes(change)}</span>
            </p>
          )}
          <button type="submit" disabled={busy || !!pending || tenderedKes === null || tenderedKes < 1} className={`${primaryBtn} w-full sm:w-auto`}>
            {busy ? 'Recording…' : 'Record cash payment'}
          </button>
        </form>
      )}

      {tab === 'card' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (amountKes === null) return;
            void run(async () => {
              await api.recordPayment(bill.id, { method: 'CARD', amountKes, reference: cardRef, idempotencyKey: attemptKey.current });
              return 'Card payment recorded.';
            });
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cardAmount" className={label}>
                Amount
              </label>
              <input id="cardAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="cardRef" className={label}>
                Card machine reference or last 4 digits
              </label>
              <input id="cardRef" autoComplete="off" value={cardRef} maxLength={30} onChange={(e) => setCardRef(e.target.value)} className={input} />
            </div>
          </div>
          <button type="submit" disabled={busy || !!pending || amountKes === null || !cardRef.trim()} className={`${primaryBtn} w-full sm:w-auto`}>
            {busy ? 'Recording…' : 'Record card payment'}
          </button>
        </form>
      )}

      {tab === 'mpesa' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Pays the clinic&apos;s {s.mobileMoneyType === 'PAYBILL' ? 'paybill' : 'till'} {s.mobileMoneyNumber}.
          </p>
          {lastStk && <StkStatus payment={lastStk} />}
          {s.stkAvailable ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (amountKes === null) return;
                void run(async () => {
                  const res = await api.requestMpesa(bill.id, { amountKes, phone, idempotencyKey: attemptKey.current });
                  return res.status === 'PENDING' ? 'Payment request sent. Ask the patient to enter their M-Pesa PIN.' : res.resultDesc;
                });
              }}
              className="space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="stkAmount" className={label}>
                    Amount
                  </label>
                  <input id="stkAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
                </div>
                <div>
                  <label htmlFor="stkPhone" className={label}>
                    Patient&apos;s M-Pesa phone
                  </label>
                  <input id="stkPhone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
                </div>
              </div>
              <button type="submit" disabled={busy || !!pending || amountKes === null} className="w-full rounded-md bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-50 sm:w-auto">
                {busy ? 'Sending…' : lastStk && lastStk.status !== 'SUCCEEDED' && lastStk.status !== 'PENDING' ? 'Retry payment request' : 'Request payment'}
              </button>
            </form>
          ) : (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">M-Pesa requests aren&apos;t set up yet. Record the M-Pesa code after the patient pays the till.</p>
          )}

          {s.stkAvailable && !showManualCode ? (
            <button type="button" onClick={() => setShowManualCode(true)} className="text-sm font-medium text-slate-700 underline">
              Prompt didn&apos;t work, or patient paid the till directly? Enter M-Pesa code
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (amountKes === null) return;
                void run(async () => {
                  await api.recordPayment(bill.id, { method: 'MPESA_MANUAL', amountKes, mpesaCode, idempotencyKey: attemptKey.current });
                  return 'M-Pesa payment recorded.';
                });
              }}
              className="space-y-3 rounded-md border border-slate-200 p-4"
            >
              <p className="text-sm font-medium text-slate-800">Enter M-Pesa code</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="mpesaCode" className={label}>
                    M-Pesa code (from the patient&apos;s SMS)
                  </label>
                  <input
                    id="mpesaCode"
                    autoComplete="off"
                    value={mpesaCode}
                    maxLength={12}
                    onChange={(e) => setMpesaCode(e.target.value.toUpperCase())}
                    placeholder="QAB12CD34E"
                    className={`${input} font-mono uppercase`}
                  />
                </div>
                <div>
                  <label htmlFor="manualAmount" className={label}>
                    Amount
                  </label>
                  <input id="manualAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
                </div>
              </div>
              <button type="submit" disabled={busy || !!pending || amountKes === null || mpesaCode.trim().length < 10} className={`${primaryBtn} w-full sm:w-auto`}>
                {busy ? 'Recording…' : 'Record M-Pesa payment'}
              </button>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
          {notice}
        </p>
      )}
    </div>
  );
}

function StkStatus({ payment }: { payment: CheckoutPayment }) {
  const s = PAYMENT_STATUS[payment.status];
  const text: Record<PaymentStatus, string> = {
    PENDING: `Waiting for the patient to enter their M-Pesa PIN on ${payment.phoneNumber ?? 'their phone'}…`,
    SUCCEEDED: `Paid ${kes(payment.amountKes)}${payment.mpesaReceiptNumber ? ` · ${payment.mpesaReceiptNumber}` : ''}`,
    FAILED: payment.resultDesc ?? 'The payment failed.',
    CANCELLED: 'The patient cancelled the M-Pesa prompt.',
    TIMED_OUT: 'No answer from the patient in time.',
    VOIDED: 'Voided.',
  };
  return (
    <div className="flex items-start gap-3 rounded-md border border-slate-200 p-3" aria-live="polite">
      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>
      <p className="text-sm text-slate-700">{text[payment.status]}</p>
    </div>
  );
}

// --- Payment history ------------------------------------------------------------

function PaymentList({ view, isAdmin, onChanged }: { view: CheckoutView; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function voidOne(p: CheckoutPayment): Promise<void> {
    const reason = window.prompt(`Void ${METHOD_LABEL[p.method]} payment of ${kes(p.amountKes)}?\n\nReason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError('A reason is required to void a payment.');
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      await api.voidPayment(p.id, reason.trim());
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void the payment.');
    } finally {
      setBusyId(null);
    }
  }

  if (view.payments.length === 0) return <p className="text-sm text-slate-500">No payments yet.</p>;

  return (
    <>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {view.payments.map((p) => {
          const s = PAYMENT_STATUS[p.status];
          const ref = p.mpesaReceiptNumber ?? p.reference;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${p.status === 'VOIDED' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {METHOD_LABEL[p.method]} · {kes(p.amountKes)}
                  {ref && <span className="ml-1 font-mono text-xs text-slate-500">{ref}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {p.takenByName} · {new Date(p.completedAt ?? p.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                  {p.method === 'CASH' && p.cashTenderedKes !== null && ` · received ${kes(p.cashTenderedKes)}, change ${kes(p.changeKes ?? 0)}`}
                </p>
                {p.status === 'VOIDED' && (
                  <p className="text-xs text-slate-500">
                    Voided by {p.voidedByName}: {p.voidReason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>
                {isAdmin && p.status === 'SUCCEEDED' && (
                  <button type="button" onClick={() => void voidOne(p)} disabled={busyId === p.id} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:border-red-400 hover:text-red-700 disabled:opacity-50">
                    Void
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- Receipt ----------------------------------------------------------------------

function Receipt({ view, clinicName }: { view: CheckoutView; clinicName: string }) {
  const bill = view.bill!;
  const paid = view.payments.filter((p) => p.status === 'SUCCEEDED');
  return (
    <div id="receipt" className="rounded-lg border border-slate-200 bg-white p-5 text-sm print:border-0 print:p-0">
      <div className="mb-3 text-center">
        <p className="text-base font-semibold text-slate-900">{clinicName}</p>
        <p className="text-slate-500">Receipt {bill.billNumber}</p>
        <p className="text-slate-500">{new Date(bill.paidAt ?? bill.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </div>
      <p className="mb-2 text-slate-700">
        {view.patient.name} · {view.patient.patientCode}
      </p>
      <table className="w-full">
        <tbody>
          {bill.items.map((item, i) => (
            <tr key={i}>
              <td className="py-0.5 text-slate-700">{item.description}</td>
              <td className="py-0.5 text-right tabular-nums">{kes(item.amountKes)}</td>
            </tr>
          ))}
          {bill.discountKes > 0 && (
            <tr>
              <td className="py-0.5 text-slate-700">Discount ({bill.discountReason})</td>
              <td className="py-0.5 text-right tabular-nums">− {kes(bill.discountKes)}</td>
            </tr>
          )}
          <tr className="border-t border-slate-200 font-semibold">
            <td className="pt-1">Total</td>
            <td className="pt-1 text-right tabular-nums">{kes(bill.totalKes)}</td>
          </tr>
          {paid.map((p) => (
            <tr key={p.id} className="text-slate-600">
              <td className="py-0.5">
                Paid · {METHOD_LABEL[p.method]} {p.mpesaReceiptNumber ?? p.reference ?? ''}
              </td>
              <td className="py-0.5 text-right tabular-nums">{kes(p.amountKes)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="pt-1">Balance</td>
            <td className="pt-1 text-right tabular-nums">{kes(bill.balanceKes)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-center text-slate-500">Thank you.</p>
    </div>
  );
}

// --- Page -------------------------------------------------------------------------

export function CheckoutPage() {
  const { encounterId = '' } = useParams();
  const { session } = useAuth();
  const [view, setView] = useState<CheckoutView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api.getCheckout(encounterId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this visit.');
    }
  }, [encounterId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live M-Pesa status: while a request is waiting, refresh every 3 seconds.
  const hasPending = view?.payments.some((p) => p.status === 'PENDING') ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [hasPending, load]);

  async function finishCheckout(): Promise<void> {
    if (!view || finishing) return;
    const balance = view.bill ? view.bill.balanceKes : null;
    if (balance === null && !window.confirm('There is no bill for this visit. Check the patient out anyway?')) return;
    if (balance && !window.confirm(`The patient still owes ${kes(balance)}. Check them out anyway? The balance stays open and can be paid later.`)) return;
    setFinishing(true);
    setFinishError(null);
    try {
      await api.checkoutCheckIn(view.checkInId, 'sms');
      await load();
    } catch (err) {
      setFinishError(err instanceof ApiError ? err.message : 'Could not complete checkout.');
    } finally {
      setFinishing(false);
    }
  }

  if (session?.role === 'DOCTOR') return <p className="text-sm text-slate-600">Billing is done at the front desk.</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;

  const bill = view.bill;
  const canBill = view.visitStatus === 'READY_FOR_CHECKOUT' || view.visitStatus === 'DONE';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="print:hidden">
        <p className="mb-2 text-sm">
          <Link to="/queue" className="text-slate-500 hover:text-slate-900">
            ← Back to queue
          </Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Bill &amp; payment</h1>
            <p className="text-sm text-slate-500">
              {view.patient.name} · {view.patient.patientCode} · {view.departmentName}
            </p>
            {view.patient.smsOptOut && <p className="mt-1 text-xs text-slate-500">Patient doesn&apos;t want SMS — no receipt will be texted.</p>}
          </div>
          <BillStatusChip status={bill?.status ?? null} />
        </div>
      </div>

      {!canBill ? (
        <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 print:hidden">The bill can be made once the doctor has finished with this patient.</p>
      ) : (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-5 print:hidden">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Bill{bill && <span className="ml-2 font-mono text-xs font-normal text-slate-500">{bill.billNumber}</span>}</h2>
              {bill && !editing && (
                <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-slate-700 underline">
                  Edit bill
                </button>
              )}
            </div>
            {!bill || editing ? (
              <BillEditor
                key={bill?.id ?? 'new'}
                view={view}
                onSaved={(v) => {
                  setView(v);
                  setEditing(false);
                }}
                onCancel={bill ? () => setEditing(false) : undefined}
              />
            ) : (
              <div className="space-y-1 text-sm">
                {bill.items.map((item, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-slate-700">{item.description}</span>
                    <span className="tabular-nums">{kes(item.amountKes)}</span>
                  </div>
                ))}
                {bill.discountKes > 0 && (
                  <div className="flex justify-between gap-3 text-slate-600">
                    <span>Discount — {bill.discountReason}</span>
                    <span className="tabular-nums">− {kes(bill.discountKes)}</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-center">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900">{kes(bill.totalKes)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Paid</p>
                    <p className="text-lg font-semibold tabular-nums text-emerald-700">{kes(bill.paidKes)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Balance</p>
                    <p className={`text-lg font-bold tabular-nums ${bill.balanceKes > 0 ? 'text-red-700' : 'text-slate-900'}`}>{kes(bill.balanceKes)}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {bill && !editing && bill.balanceKes > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 print:hidden">
              <h2 className="mb-3 font-semibold text-slate-900">Take payment</h2>
              <PaymentPanel view={view} onChanged={load} />
            </section>
          )}

          {bill && bill.status === 'PAID' && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900 print:hidden">
              Fully paid.{' '}
              {view.patient.smsOptOut ? 'No SMS receipt (patient opted out).' : bill.receiptSmsSentAt ? 'SMS receipt sent.' : 'SMS receipt is being sent.'}
            </p>
          )}

          {bill && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 print:hidden">
              <h2 className="mb-2 font-semibold text-slate-900">Payments</h2>
              <PaymentList view={view} isAdmin={session?.role === 'ADMIN'} onChanged={load} />
            </section>
          )}

          {bill && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 print:hidden">
                <button type="button" onClick={() => setShowReceipt((v) => !v)} className={secondaryBtn}>
                  {showReceipt ? 'Hide receipt' : 'Show receipt'}
                </button>
                {showReceipt && (
                  <button type="button" onClick={() => window.print()} className={secondaryBtn}>
                    Print receipt
                  </button>
                )}
              </div>
              {showReceipt && <Receipt view={view} clinicName={session?.clinicName ?? ''} />}
            </div>
          )}

          {view.visitStatus === 'READY_FOR_CHECKOUT' && (
            <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 print:hidden sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">Finish the visit and send the visit summary.</p>
              <button type="button" onClick={() => void finishCheckout()} disabled={finishing} className={primaryBtn}>
                {finishing ? 'Checking out…' : 'Complete checkout'}
              </button>
            </section>
          )}
          {view.visitStatus === 'DONE' && <p className="text-sm text-slate-500 print:hidden">This visit is checked out.</p>}
          {finishError && <p className="text-sm text-red-600">{finishError}</p>}
        </>
      )}
    </div>
  );
}
