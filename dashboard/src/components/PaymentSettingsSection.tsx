import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, PaymentSettings } from '../lib/api';
import { Banknote, Check, CreditCard, FlaskConical, Smartphone } from 'lucide-react';
import { btn, field, Skeleton } from './ui';

const input = `${field.input} text-base sm:text-[15px]`;
const METHOD_ICON = { acceptsCash: Banknote, acceptsCard: CreditCard, acceptsMobileMoney: Smartphone } as const;

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

  if (!s)
    return message ? (
      <p role="alert" className="text-sm text-red-700">
        {message.text}
      </p>
    ) : (
      <div role="status" aria-label="Loading payment settings" className="grid grid-cols-3 gap-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );

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
    <form onSubmit={(e) => void save(e)} className="space-y-5">
      <fieldset>
        <legend className={field.label}>Payment methods accepted at checkout</legend>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(
            [
              ['acceptsCash', 'Cash'],
              ['acceptsCard', 'Card'],
              ['acceptsMobileMoney', 'Mobile money'],
            ] as const
          ).map(([key, text]) => (
            <label
              key={key}
              className={`relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 text-center text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-500 ${
                s[key] ? 'border-gold-500 bg-gold-tint text-navy-900' : 'border-slate-200 bg-white text-ink-500 hover:border-slate-300'
              }`}
            >
              <input type="checkbox" checked={s[key]} onChange={(e) => set({ [key]: e.target.checked })} className="sr-only" />
              {(() => {
                const Icon = METHOD_ICON[key];
                return (
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${s[key] ? 'bg-foil text-navy-900' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon size={20} aria-hidden />
                  </span>
                );
              })()}
              {text}
              <span className={`text-xs font-medium ${s[key] ? 'text-emerald-700' : 'text-ink-400'}`}>
                {s[key] ? (
                  <span className="inline-flex items-center gap-1">
                    <Check size={12} aria-hidden strokeWidth={3} /> On
                  </span>
                ) : (
                  'Off'
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {s.acceptsMobileMoney && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-cream-50 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-navy-900">
            <Smartphone size={16} aria-hidden className="text-emerald-700" /> Payments go to the clinic&apos;s own number below — never to ACISI.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className={field.label}>Type</span>
              <select value={s.mobileMoneyType ?? ''} onChange={(e) => set({ mobileMoneyType: (e.target.value || null) as PaymentSettings['mobileMoneyType'] })} className={input}>
                <option value="">Choose…</option>
                <option value="TILL">Till (Buy Goods)</option>
                <option value="PAYBILL">Paybill</option>
              </select>
            </label>
            <label className="text-sm">
              <span className={field.label}>{s.mobileMoneyType === 'PAYBILL' ? 'Paybill' : 'Till'} number</span>
              <input inputMode="numeric" value={s.mobileMoneyNumber ?? ''} onChange={(e) => set({ mobileMoneyNumber: e.target.value })} placeholder="e.g. 123456" className={input} />
            </label>
          </div>
          {s.mobileMoneyType === 'PAYBILL' && (
            <label className="block text-sm">
              <span className={field.label}>Account reference format</span>
              <input value={s.paybillAccountFormat ?? ''} onChange={(e) => set({ paybillAccountFormat: e.target.value })} placeholder="{patientCode}" className={input} />
              <span className="mt-1.5 block text-xs text-ink-500">Use {'{patientCode}'} (e.g. ACI-7F2K) or {'{billNumber}'} (e.g. B-7F2K9Q). Max 12 characters are sent.</span>
            </label>
          )}
          {stk && (
            <p className="flex items-start gap-2 rounded-xl bg-white px-3.5 py-2.5 text-xs text-ink-700 ring-1 ring-slate-200">
              <FlaskConical size={15} aria-hidden className="flex-none text-teal-700" />
              {stk.configured
                ? `"Request payment" (M-Pesa prompt) is on in ${stk.mode.toUpperCase()} mode — test only, no real money.`
                : '"Request payment" isn\'t set up on this server yet; staff can still record M-Pesa codes.'}
            </p>
          )}
        </div>
      )}

      <label className="block max-w-xs text-sm">
        <span className={field.label}>Default consultation fee (KES)</span>
        <input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} className={input} />
        <span className="mt-1.5 block text-xs text-ink-500">Pre-filled on every new bill; staff can change it.</span>
      </label>

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`rounded-xl px-3.5 py-2.5 text-sm ${message.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-red-200 bg-red-50 text-red-700'}`}
        >
          {message.text}
        </p>
      )}
      <button type="submit" disabled={saving} className={btn.gold}>
        {saving ? 'Saving…' : 'Save payment settings'}
      </button>
    </form>
  );
}
