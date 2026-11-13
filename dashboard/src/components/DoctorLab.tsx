import { FormEvent, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Paperclip, Send, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, LabOrderView, LabResult, LabResultFlag, LabTestItem } from '../lib/api';
import { Badge, btn, field, StatusBadge } from './ui';

const FLAG_LABEL: Record<LabResultFlag, string> = { NORMAL: 'Normal', ABNORMAL: 'Abnormal', CRITICAL: 'Critical' };
const FLAG_TONE: Record<LabResultFlag, 'success' | 'warning' | 'danger'> = { NORMAL: 'success', ABNORMAL: 'warning', CRITICAL: 'danger' };

function formatKes(n: number): string {
  return `KES ${n.toLocaleString('en-KE')}`;
}

/** One result line: "Haemoglobin  9.1 g/dL  [Abnormal]" plus the lab's comment. */
export function LabResultLine({ testName, value, unit, flag, comment }: Pick<LabResult, 'testName' | 'value' | 'unit' | 'flag' | 'comment'>) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-navy-900">{testName}</span>
        <span className="text-ink-700">{[value, unit].filter(Boolean).join(' ') || '—'}</span>
        {flag && (
          <Badge tone={FLAG_TONE[flag]} className="ml-auto">
            {FLAG_LABEL[flag]}
          </Badge>
        )}
      </div>
      {comment && <p className="mt-0.5 text-sm text-ink-500">{comment}</p>}
    </li>
  );
}

/** This visit's lab requests on the consultation page: waiting at the lab, or the signed results. */
export function LabOrdersForVisit({ orders }: { orders: LabOrderView[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/40 p-5 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-navy-900">
        <FlaskConical size={18} aria-hidden className="text-blue-700" /> Lab results
      </h2>
      <div className="space-y-4">
        {orders.map((o) => (
          <div key={o.id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <StatusBadge status={o.status} />
              <span>
                Requested {new Date(o.requestedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })} by {o.requestedByName}
              </span>
              {o.completedByName && o.completedAt && (
                <span>
                  Signed by {o.completedByName} at {new Date(o.completedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              )}
            </div>
            {o.status === 'RESULTS_READY' ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {o.items.map((i) => (
                  <LabResultLine key={i.id} testName={i.testName} value={i.resultValue} unit={i.resultUnit} flag={i.resultFlag} comment={i.resultComment} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-700">At the lab: {o.items.map((i) => i.testName).join(', ')}</p>
            )}
            {o.files.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {o.files.map((f, idx) => (
                  <li key={f.id}>
                    <a
                      href={api.patientFileUrl(f.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-cream-50 px-3 py-1 text-sm font-medium text-navy-900 ring-1 ring-slate-200 hover:ring-gold-500"
                    >
                      <Paperclip size={14} aria-hidden /> Lab printout {o.files.length > 1 ? idx + 1 : ''}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * "Request lab tests": the doctor ticks tests from the clinic's list, adds an
 * optional note for the lab, and signs with their PIN. The patient then goes
 * to the lab queue and comes back to this doctor when the results are signed.
 */
export function RequestLabTests({ encounterId, onSent }: { encounterId: string; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [tests, setTests] = useState<LabTestItem[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tests) return;
    api
      .getDoctorLabTests()
      .then((r) => setTests(r.tests))
      .catch(() => setError('Could not load the lab tests.'));
  }, [open, tests]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (tests ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [tests, filter]);

  function toggle(id: string): void {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestLabTests(encounterId, { labTestIds: chosen, noteForLab: note, pin });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send to the lab. Try again.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${btn.secondary} w-full sm:w-auto`} onClick={() => setOpen(true)}>
        <FlaskConical size={16} aria-hidden /> Request lab tests
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-2xl bg-cream-50 p-4 ring-1 ring-slate-200 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-navy-900">
          <FlaskConical size={18} aria-hidden className="text-blue-700" /> Request lab tests
        </h3>
        <button type="button" aria-label="Close" className="rounded-full p-1.5 text-ink-500 hover:bg-white" onClick={() => setOpen(false)} disabled={busy}>
          <X size={18} aria-hidden />
        </button>
      </div>

      {tests === null && !error && <p className="text-sm text-ink-500">Loading tests…</p>}
      {tests && tests.length === 0 && (
        <p className="rounded-xl bg-white px-3.5 py-3 text-sm text-ink-700 ring-1 ring-slate-200">
          Your clinic has no lab tests set up yet. A clinic admin can add them in Settings → Lab tests.
        </p>
      )}
      {tests && tests.length > 0 && (
        <>
          {tests.length > 8 && (
            <label className="mb-2 block">
              <span className="sr-only">Find a test</span>
              <input className={field.input} placeholder="Find a test" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          <fieldset>
            <legend className={field.label}>Tests</legend>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {shown.map((t) => (
                <li key={t.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white px-3.5 py-2 ring-1 ring-slate-200 has-[:checked]:ring-2 has-[:checked]:ring-gold-500">
                    <input type="checkbox" className="h-5 w-5 accent-navy-900" checked={chosen.includes(t.id)} onChange={() => toggle(t.id)} />
                    <span className="flex-1 text-[15px] text-navy-900">{t.name}</span>
                    <span className="text-sm text-ink-500">{formatKes(t.priceKes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <label className="mt-3 block">
            <span className={field.label}>Note for the lab (optional, not the diagnosis)</span>
            <input className={field.input} maxLength={500} placeholder="e.g. fasting since 8pm" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="mt-3 block">
            <span className={field.label}>
              <ShieldCheck size={14} aria-hidden className="mr-1 inline text-gold-700" /> Your PIN to sign the request
            </span>
            <input
              className={field.input}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
            />
          </label>
          <p className="mt-3 text-sm text-ink-500">
            The patient goes to the lab queue now and comes back to you when the results are signed. The tests are added to the bill at checkout.
          </p>
          <button type="submit" className={`${btn.gold} mt-3 w-full sm:w-auto`} disabled={busy || chosen.length === 0 || !pin}>
            <Send size={16} aria-hidden /> {busy ? 'Sending…' : `Send to lab (${chosen.length} test${chosen.length === 1 ? '' : 's'})`}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
