import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ShieldAlert, TableProperties } from 'lucide-react';
import { api, ApiError, NotifiableCase, WeeklySurveillance, IHR_TEXT } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { btn, Card, EmptyState, field, SkeletonList } from '../components/ui';
import { HealthEvents } from '../components/HealthEvents';

/** Monday (YYYY-MM-DD) of this week, Kenya time. */
function thisWeek(): string {
  const local = new Date(Date.now() + 3 * 60 * 60 * 1000);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}

/** Monday of last week: the week that gets reported. */
const lastFullWeek = () => shiftWeek(thisWeek(), -1);

function shiftWeek(week: string, by: number): string {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * by);
  return d.toISOString().slice(0, 10);
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

function ListNotice({ confirmed, source }: { confirmed: string | null; source?: string }) {
  if (confirmed)
    return (
      <p className="mb-4 text-xs text-ink-500">
        Disease list from {source ?? 'the MOH IDSR case definitions'}, checked {confirmed}.
      </p>
    );
  return (
    <p className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
      Draft disease list: not yet confirmed against the Ministry of Health IDSR case definitions. Follow the official guidelines
      if they differ.
    </p>
  );
}

function ReportedForm({ c, onDone }: { c: NotifiableCase; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.markNotifiableReported(c.id, note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>
        Mark as reported
      </button>
    );
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 space-y-2">
      <label className={field.label} htmlFor={`note-${c.id}`}>
        Who took the report? (optional)
      </label>
      <input
        id={`note-${c.id}`}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. SCDSC, by phone; MOH 502 sent"
        className={field.input}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={btn.gold} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm reported'}
        </button>
      </div>
    </form>
  );
}

function Cases() {
  const [cases, setCases] = useState<NotifiableCase[] | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listNotifiableCases()
      .then((r) => {
        setCases(r.cases);
        setConfirmed(r.listConfirmed);
        setSource(r.listSource);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load cases'));
  }, []);
  useEffect(load, [load]);

  if (error)
    return (
      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  if (!cases) return <SkeletonList rows={3} label="Loading cases" />;

  return (
    <Card title="Notifiable disease cases" icon={ShieldAlert} bodyClassName="p-0">
      <div className="px-5 pt-4">
        <ListNotice confirmed={confirmed} source={source} />
      </div>
      {cases.length === 0 ? (
        <EmptyState icon={CheckCircle2} tone="success" title="No notifiable diseases diagnosed yet." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {cases.map((c) => (
            <li key={c.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">
                    {c.diseaseName} <span className="font-mono text-sm font-semibold text-teal-800">{c.icd11Code}</span>
                  </p>
                  <p className="text-sm text-ink-700">
                    {c.patientName} · {c.patientCode} · {c.age === null ? 'age unknown' : `${c.age} y`} · {c.sex.toLowerCase()}
                  </p>
                  <p className="text-xs text-ink-500">
                    Diagnosed {dateTime(c.diagnosedAt)} by {c.diagnosedBy}
                  </p>
                </div>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {c.ihr && (
                    <span className="rounded-full bg-red-700 px-2.5 py-1 text-xs font-semibold text-white" title={IHR_TEXT[c.ihr]}>
                      IHR
                    </span>
                  )}
                  {c.reporting === 'IMMEDIATE' ? (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">Report within 24 hours</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-ink-700">Weekly report</span>
                  )}
                </span>
              </div>
              {c.reportedAt ? (
                <p className="mt-2 flex items-start gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 size={15} aria-hidden className="mt-0.5 flex-none" />
                  Reported {dateTime(c.reportedAt)} by {c.reportedBy}
                  {c.reportNote ? `: ${c.reportNote}` : ''}
                </p>
              ) : c.reporting === 'IMMEDIATE' ? (
                <div className="mt-2">
                  {c.ihr && <p className="mb-2 text-xs font-semibold text-red-800">{IHR_TEXT[c.ihr]}</p>}
                  <ReportedForm c={c} onDone={load} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Weekly() {
  const [week, setWeek] = useState(lastFullWeek);
  const [data, setData] = useState<WeeklySurveillance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .weeklySurveillance(week)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Failed to load the summary'));
    return () => {
      cancelled = true;
    };
  }, [week]);

  const latest = thisWeek();
  return (
    <Card
      title="Weekly summary"
      icon={TableProperties}
      actions={
        <a href={api.weeklySurveillanceCsvUrl(week)} className={btn.secondary} download>
          <Download size={16} aria-hidden /> CSV
        </a>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className={btn.secondary} onClick={() => setWeek((w) => shiftWeek(w, -1))}>
          ← Previous
        </button>
        <span className="font-medium text-navy-900">
          {data ? `${data.weekStart} to ${data.weekEnd}` : week} (Monday to Sunday){week === latest ? ', in progress' : ''}
        </span>
        <button type="button" className={btn.secondary} onClick={() => setWeek((w) => shiftWeek(w, 1))} disabled={week >= latest}>
          Next →
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <SkeletonList rows={4} label="Loading the summary" />}
      {data && (
        <>
          <ListNotice confirmed={data.listConfirmed} source={data.listSource} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="py-2 pr-3 font-semibold">MOH 505 row</th>
                  <th className="px-3 py-2 text-right font-semibold">Under 5</th>
                  <th className="px-3 py-2 text-right font-semibold">5 and over</th>
                  <th className="px-3 py-2 text-right font-semibold">Age unknown</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="py-2 pl-3 text-right font-semibold">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.diseaseId} className={`border-b border-slate-100 ${r.total + r.deathsUnder5 + r.deathsFiveAndOver > 0 ? 'font-semibold text-navy-900' : 'text-ink-500'}`}>
                    <td className="py-2 pr-3">
                      {r.form505Row}
                      {r.form505Row !== r.name && <span className="block text-xs font-normal text-ink-500">{r.name}</span>}
                      {r.reporting === 'IMMEDIATE' && <span className="block text-xs font-normal text-red-700">immediate</span>}
                      {r.source === 'EVENTS' && <span className="block text-xs font-normal text-ink-500">from recorded events</span>}
                    </td>
                    {r.countedByAcisi ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">{r.under5}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.fiveAndOver}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.ageUnknown}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                        <td className="py-2 pl-3 text-right tabular-nums">{r.deathsUnder5 + r.deathsFiveAndOver || ''}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-2 pl-3 pr-1 text-right text-xs italic text-amber-800">
                        count by hand
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Cases come from ICD-11 diagnoses signed at this clinic; rows marked &quot;from recorded events&quot; come from the public health events
            below. Deaths come from recorded events only (ACISI doesn&apos;t record deaths on visits); the CSV splits them under 5 / 5 and over.
            The form goes to the SCDSC by Monday.
          </p>
        </>
      )}
    </Card>
  );
}

/** Doctors: cases (with patient) and the weekly summary. Admins: weekly summary only (numbers, no names). */
export function SurveillancePage() {
  const { session } = useAuth();
  const isDoctor = session?.role === 'DOCTOR';
  return (
    <div className="space-y-6">
      {isDoctor && <Cases />}
      <HealthEvents />
      <Weekly />
    </div>
  );
}
