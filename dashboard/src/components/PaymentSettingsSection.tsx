import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, PaymentSettings } from '../lib/api';

const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base sm:text-sm focus:border-slate-500 focus:outline-none';

/** Clinic admin: which payment methods the clinic takes at checkout, and where mobile money goes. */
export function PaymentSettingsSection() {
  const [s, setS] = useState<PaymentSettings | null>(null);
  const [stk, setStk] = useState<{ configured: boolean; mode: string } | null>(null);
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getPaymentSettings()
      .then(({ stkConfigured, stkMode, ...settings }) => {
        setS(settings);
        setFee(String(settings.defaultConsultationFeeKes));
        setStk({ configured: stkConfigured, mode: stkMode });
      })
      .catch(() => setMessage({ ok: false, text: 'Could not load payment settings.' }));
  }, []);

  if (!s) return message ? <p className="text-sm text-red-600">{message.text}</p> : <p className="text-sm text-slate-500">Loading…</p>;

  const set = (patch: Partial<PaymentSettings>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!s || saving) return;
    const feeKes = /^\d{1,8}$/.test(fee.trim()) ? Number(fee.trim()) : NaN;
    if (Number.isNaN(feeKes)) {
      setMessage({ ok: false, text: 'Enter the consultation fee as a whole number of KES.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.savePaymentSettings({ ...s, defaultConsultationFeeKes: feeKes });
      setMessage({ ok: true, text: 'Payment settings saved.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Payment methods accepted at checkout</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ['acceptsCash', 'Cash'],
              ['acceptsCard', 'Card'],
              ['acceptsMobileMoney', 'Mobile money'],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={s[key]} onChange={(e) => set({ [key]: e.target.checked })} className="h-5 w-5" />
              {text}
            </label>
          ))}
        </div>
      </div>

      {s.acceptsMobileMoney && (
        <div className="space-y-3 rounded-md border border-slate-200 p-4">
          <p className="text-sm text-slate-600">Payments go to the clinic&apos;s own number below — never to ACISI.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Type</span>
              <select value={s.mobileMoneyType ?? ''} onChange={(e) => set({ mobileMoneyType: (e.target.value || null) as PaymentSettings['mobileMoneyType'] })} className={input}>
                <option value="">Choose…</option>
                <option value="TILL">Till (Buy Goods)</option>
                <option value="PAYBILL">Paybill</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">{s.mobileMoneyType === 'PAYBILL' ? 'Paybill' : 'Till'} number</span>
              <input inputMode="numeric" value={s.mobileMoneyNumber ?? ''} onChange={(e) => set({ mobileMoneyNumber: e.target.value })} placeholder="e.g. 123456" className={input} />
            </label>
          </div>
          {s.mobileMoneyType === 'PAYBILL' && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Account reference format</span>
              <input value={s.paybillAccountFormat ?? ''} onChange={(e) => set({ paybillAccountFormat: e.target.value })} placeholder="{patientCode}" className={input} />
              <span className="mt-1 block text-xs text-slate-500">Use {'{patientCode}'} (e.g. ACI-7F2K) or {'{billNumber}'} (e.g. B-7F2K9Q). Max 12 characters are sent.</span>
            </label>
          )}
          {stk && (
            <p className="text-xs text-slate-500">
              {stk.configured
                ? `"Request payment" (M-Pesa prompt) is on in ${stk.mode.toUpperCase()} mode — test only, no real money.`
                : '"Request payment" isn\'t set up on this server yet; staff can still record M-Pesa codes.'}
            </p>
          )}
        </div>
      )}

      <label className="block max-w-xs text-sm">
        <span className="mb-1 block font-medium text-slate-700">Default consultation fee (KES)</span>
        <input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} className={input} />
        <span className="mt-1 block text-xs text-slate-500">Pre-filled on every new bill; staff can change it.</span>
      </label>

      {message && <p className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</p>}
      <button type="submit" disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save payment settings'}
      </button>
    </form>
  );
}
