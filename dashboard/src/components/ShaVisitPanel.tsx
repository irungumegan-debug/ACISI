import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { api, ApiError, ShaCode, ShaContact, ShaIntervention, ShaVisitState } from '../lib/api';
import { Badge, btn, Card, field } from './ui';
import { useShaAddon } from '../lib/useShaAddon';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const chip = 'rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-navy-900 hover:border-gold-500 disabled:opacity-50';

/**
 * Front desk: start this visit with SHA while the patient is here. Choose
 * the SHA services, SHA texts the patient a code, the patient reads it out,
 * and SHA opens the visit's claim. Hidden unless the SHA add-on is on for the
 * clinic and ACISI is connected to the HIE;
 * never blocks the visit (a patient can always pay cash).
 */
export function ShaVisitPanel({ encounterId }: { encounterId: string }) {
  // Optional add-on: render nothing (and ask SHA nothing) unless it is on for this clinic.
  return useShaAddon() ? <ShaVisitPanelInner encounterId={encounterId} /> : null;
}

function ShaVisitPanelInner({ encounterId }: { encounterId: string }) {
  const [state, setState] = useState<ShaVisitState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<ShaIntervention[]>([]);
  const [contacts, setContacts] = useState<ShaContact[] | null>(null);
  const [contactId, setContactId] = useState<number | undefined>(undefined);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    api
      .getShaVisit(encounterId)
      .then(setState)
      .catch(() => setState(null));
  }, [encounterId]);
  useEffect(load, [load]);

  // Tick while waiting to allow a new code.
  const resendAt = state?.visit?.status === 'CODE_SENT' ? new Date(state.visit.canResendAt).getTime() : 0;
  useEffect(() => {
    if (!resendAt || resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (codes: string[]) =>
    run(async () => {
      await api.sendShaVisitCode(encounterId, codes, contactId);
      setCode('');
      setPicking(false);
      load();
    });

  const start = () =>
    run(async () => {
      await api.startShaVisit(encounterId, code);
      setCode('');
      load();
    });

  const loadContacts = () =>
    run(async () => {
      setContacts((await api.getShaContacts(encounterId)).contacts);
    });

  if (!state || !state.connected) return null;
  const v = state.visit;

  const body = (() => {
    if (!state.facilitySet) return <p className="text-sm text-ink-500">The clinic admin needs to set the clinic&apos;s facility code first (Settings → National HIE).</p>;
    if (!state.patientLinked) return <p className="text-sm text-ink-500">Look the patient up in the national Client Registry first (patient page → National HIE).</p>;

    if (v?.status === 'STARTED') {
      return (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="success" icon={BadgeCheck}>
              Started with SHA
            </Badge>
            {v.claimStatus && <span className="text-ink-500">SHA status: {v.claimStatus}</span>}
          </p>
          <p className="text-ink-700">
            SHA claim {v.claimId}
            {v.visitNumber ? ` · visit ${v.visitNumber}` : ''} · services: {v.interventionCodes.join(', ')}
          </p>
          {!v.doctorAttached && <p className="text-xs text-ink-500">No doctor on the SHA claim yet: it is added when the claim is billed (the doctor must have verified their registration in Settings → National HIE).</p>}
        </div>
      );
    }

    if (v?.status === 'CODE_SENT' && !picking) {
      const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
      return (
        <form
          className="space-y-3 text-sm"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="text-ink-700">SHA has texted the patient a code for: {v.interventionCodes.join(', ')}. Ask them to read it out.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-60">
              <label className={field.label} htmlFor="shaCode">
                Code from the patient&apos;s SMS
              </label>
              <input id="shaCode" className={field.input} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required minLength={4} maxLength={8} />
            </div>
            <button type="submit" className={btn.primary} disabled={busy || code.length < 4}>
              Start SHA visit
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={btn.ghost} disabled={busy || wait > 0} onClick={() => void sendCode(v.interventionCodes)}>
              {wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'}
            </button>
            <button type="button" className={btn.ghost} disabled={busy} onClick={() => setPicking(true)}>
              Change services
            </button>
          </div>
        </form>
      );
    }

    // Choosing services and the phone, then sending the code.
    return (
      <div className="space-y-3 text-sm">
        <p className="text-ink-700">For a patient covered by SHA: choose the services for this visit, and SHA texts the patient a code to confirm they are here.</p>
        <ServicePicker patientId={state.patientId} chosen={chosen} onChange={setChosen} onError={setError} />
        {chosen.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase text-ink-500">Phone for the code</p>
            {!contacts ? (
              <button type="button" className={chip} disabled={busy} onClick={() => void loadContacts()}>
                Use another of the patient&apos;s SHA numbers
              </button>
            ) : (
              <div className="space-y-1">
                <label className="flex items-center gap-2">
                  <input type="radio" name="shaContact" checked={contactId === undefined} onChange={() => setContactId(undefined)} /> The patient&apos;s main SHA number
                </label>
                {contacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="radio" name="shaContact" checked={contactId === c.id} onChange={() => setContactId(c.id)} /> {c.masked}
                    {!c.confirmed && <span className="text-xs text-ink-500">(not confirmed)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} disabled={busy || chosen.length === 0} onClick={() => void sendCode(chosen.map((c) => c.code))}>
            {busy ? 'Checking SHA cover…' : 'Send the SHA code'}
          </button>
          {picking && (
            <button type="button" className={btn.ghost} disabled={busy} onClick={() => setPicking(false)}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  })();

  return (
    <Card title="SHA visit" icon={ShieldCheck} className="mb-6 print:hidden">
      {body}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}

/** Benefit package → outpatient service group → services (ticked), from the patient's SHA cover at this clinic. */
function ServicePicker({
  patientId,
  chosen,
  onChange,
  onError,
}: {
  patientId: string;
  chosen: ShaIntervention[];
  onChange: (v: ShaIntervention[]) => void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [benefits, setBenefits] = useState<ShaCode[] | null>(null);
  const [benefit, setBenefit] = useState<string | null>(null);
  const [subBenefits, setSubBenefits] = useState<ShaCode[] | null>(null);
  const [subBenefit, setSubBenefit] = useState<string | null>(null);
  const [services, setServices] = useState<ShaIntervention[] | null>(null);

  async function run<T>(fn: () => Promise<T>, apply: (v: T) => void): Promise<void> {
    setBusy(true);
    onError(null);
    try {
      apply(await fn());
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (s: ShaIntervention) => onChange(chosen.some((c) => c.code === s.code) ? chosen.filter((c) => c.code !== s.code) : [...chosen, s].slice(0, 10));

  return (
    <div className="space-y-3">
      {!benefits && (
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run(() => api.getShaBenefits(patientId), (r) => setBenefits(r.benefits))}>
          {busy ? 'Loading…' : 'Choose SHA services'}
        </button>
      )}
      {benefits && (
        <div className="flex flex-wrap gap-2">
          {benefits.map((b) => (
            <button
              key={b.code}
              type="button"
              className={chip}
              aria-pressed={benefit === b.code}
              disabled={busy}
              onClick={() =>
                void run(() => api.getShaSubBenefits(patientId, b.code), (r) => {
                  setBenefit(b.code);
                  setSubBenefits(r.subBenefits);
                  setSubBenefit(null);
                  setServices(null);
                })
              }
            >
              {b.name}
            </button>
          ))}
          {benefits.length === 0 && <span className="text-ink-500">No SHA benefit packages for this patient at this clinic.</span>}
        </div>
      )}
      {subBenefits && (
        <div className="flex flex-wrap gap-2">
          {subBenefits.map((sb) => (
            <button
              key={sb.code}
              type="button"
              className={chip}
              aria-pressed={subBenefit === sb.code}
              disabled={busy}
              onClick={() =>
                void run(() => api.getShaInterventions(patientId, sb.code), (r) => {
                  setSubBenefit(sb.code);
                  setServices(r.interventions);
                })
              }
            >
              {sb.name}
            </button>
          ))}
          {subBenefits.length === 0 && <span className="text-ink-500">No outpatient services under this package.</span>}
        </div>
      )}
      {services && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {services.map((s) => (
            <li key={s.code} className="p-2.5">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={chosen.some((c) => c.code === s.code)} onChange={() => toggle(s)} />
                <span>
                  <span className="font-medium text-navy-900">{s.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-400">{s.code}</span>
                  <span className="block text-xs text-ink-500">
                    {s.tariff != null ? `SHA pays KES ${s.tariff.toLocaleString('en-KE')}` : 'No tariff given'}
                    {s.needsPreauth ? ' · needs pre-authorisation' : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {services.length === 0 && <li className="p-2.5 text-ink-500">No outpatient services found.</li>}
        </ul>
      )}
      {chosen.length > 0 && <p className="text-ink-700">Chosen: {chosen.map((c) => c.name).join(', ')}</p>}
    </div>
  );
}
