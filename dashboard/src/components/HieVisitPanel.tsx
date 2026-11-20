import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Network } from 'lucide-react';
import { api, ApiError, HieVisitState, NationalRecordItem } from '../lib/api';
import { Badge, btn, Card, field } from './ui';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/**
 * This visit's link to the national Shared Health Record (DHA HIE):
 * consent (DHA texts the patient a code), then for doctors the records
 * from other facilities, and for front desk the sending status and closing
 * the HIE visit after checkout. Never blocks the visit itself.
 */
export function HieVisitPanel({ encounterId, mode }: { encounterId: string; mode: 'doctor' | 'frontdesk' }) {
  const [state, setState] = useState<HieVisitState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [records, setRecords] = useState<NationalRecordItem[] | null>(null);

  const load = useCallback(() => {
    api
      .getHieVisit(encounterId)
      .then(setState)
      .catch(() => setState(null));
  }, [encounterId]);

  useEffect(load, [load]);

  // While a send is in progress, check again every 10 seconds.
  useEffect(() => {
    if (state?.visit?.sendStatus !== 'SENDING') return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [state?.visit?.sendStatus, load]);

  async function act(action: Parameters<typeof api.hieVisitAction>[1], body?: object): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.hieVisitAction(encounterId, action, body);
      setCode('');
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function showRecords(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setRecords((await api.getNationalRecord(encounterId)).items);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Hidden entirely until ACISI is connected to the HIE.
  if (!state || !state.connected) return null;
  const v = state.visit;

  const body = (() => {
    if (!state.facilitySet) return <p className="text-sm text-ink-500">The clinic admin needs to set the clinic&apos;s facility code first (National HIE page).</p>;
    if (!state.patientLinked) {
      return (
        <p className="text-sm text-ink-500">
          The patient hasn&apos;t been found in the national Client Registry yet. Front desk: patient page → ID and next of kin → Look up.
        </p>
      );
    }

    // Asking for consent.
    if (!v || v.consentStatus === 'REJECTED') {
      return (
        <div className="space-y-3 text-sm">
          {v?.consentStatus === 'REJECTED' && <p className="text-ink-700">The patient declined to share this visit with the national record.</p>}
          <p className="text-ink-700">
            With the patient&apos;s consent, this visit is added to their national health record{mode === 'doctor' ? ' and you can see their records from other facilities' : ''}. DHA sends the patient a code by SMS.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act('consent')}>
              {v ? 'Ask again' : 'Ask the patient for consent'}
            </button>
            {mode === 'doctor' && (
              <button
                type="button"
                className={btn.ghost}
                disabled={busy}
                onClick={() => {
                  const reason = prompt('Emergency: why can the patient not consent? (e.g. "Unconscious")');
                  if (reason && reason.trim().length >= 3) void act('consent', { emergencyReason: reason.trim() });
                }}
              >
                Emergency: patient can&apos;t consent
              </button>
            )}
          </div>
        </div>
      );
    }

    if (v.consentStatus === 'PENDING') {
      return (
        <form
          className="space-y-3 text-sm"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void act('consent/confirm', { code });
          }}
        >
          <p className="text-ink-700">DHA has sent the patient a code by SMS. Ask them to read it out.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-60">
              <label className={field.label} htmlFor={`hieCode-${mode}`}>
                Code from the patient&apos;s SMS
              </label>
              <input id={`hieCode-${mode}`} className={field.input} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required minLength={4} maxLength={8} />
            </div>
            <button type="submit" className={btn.primary} disabled={busy || code.length < 4}>
              Confirm consent
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={btn.ghost} disabled={busy} onClick={() => void act('consent/resend')}>
              Send the code again
            </button>
            <button
              type="button"
              className={btn.ghost}
              disabled={busy}
              onClick={() => {
                if (confirm('Record that the patient does not consent? This visit will not be shared with the national record.')) void act('consent/refuse', { reason: 'Patient declined' });
              }}
            >
              Patient says no
            </button>
          </div>
        </form>
      );
    }

    // Approved.
    return (
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone="success" icon={BadgeCheck}>
            {v.emergency ? 'Emergency consent' : 'Consent given'}
          </Badge>
          {mode === 'frontdesk' && <SendStatus v={v} />}
        </p>

        {mode === 'doctor' && (
          <>
            {!records && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => void showRecords()}>
                {busy ? 'Loading…' : 'Show records from other facilities'}
              </button>
            )}
            {records && records.length === 0 && <p className="text-ink-500">No records from other facilities in the national record.</p>}
            {records && records.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {records.map((r, i) => (
                  <li key={i} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:gap-3">
                    <span className="w-28 flex-none text-xs text-ink-500">{r.date ? new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'}</span>
                    <span className="min-w-0">
                      <span className="mr-2 text-xs font-semibold uppercase text-gold-700">{r.kind}</span>
                      <span className="font-medium text-navy-900">{r.title}</span>
                      {r.detail && <span className="block text-ink-700">{r.detail}</span>}
                      {r.facility && <span className="block text-xs text-ink-500">{r.facility}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-500">Shown from DHA, not saved in ACISI. This visit is sent to the national record at checkout.</p>
          </>
        )}

        {mode === 'frontdesk' && v.sendStatus === 'FAILED' && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act('send')}>
            Try sending again
          </button>
        )}
        {mode === 'frontdesk' && v.sendStatus === 'SENT' && v.closeStatus === 'OPEN' && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void act('close')}>
            Close the HIE visit
          </button>
        )}
        {mode === 'frontdesk' && v.closeStatus === 'CODE_SENT' && (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void act('close/confirm', { code });
            }}
          >
            <div className="sm:w-56">
              <label className={field.label} htmlFor="hieCloseCode">
                Closing code from the patient&apos;s SMS
              </label>
              <input id="hieCloseCode" className={field.input} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required minLength={4} maxLength={8} />
            </div>
            <button type="submit" className={btn.primary} disabled={busy || code.length < 4}>
              Close visit
            </button>
          </form>
        )}
        {v.closeStatus === 'CLOSED' && <p className="text-ink-500">HIE visit closed.</p>}
      </div>
    );
  })();

  return (
    <Card title="National health record (HIE)" icon={Network} className="mb-6 print:hidden">
      {body}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}

function SendStatus({ v }: { v: NonNullable<HieVisitState['visit']> }) {
  const text = {
    NOT_SENT: 'Sent to the national record at checkout',
    SENDING: 'Sending to the national record…',
    SENT: 'Sent to the national record',
    FAILED: "Couldn't send to the national record",
  }[v.sendStatus];
  return <span className={v.sendStatus === 'FAILED' ? 'font-semibold text-red-700' : 'text-ink-500'}>{text}</span>;
}
