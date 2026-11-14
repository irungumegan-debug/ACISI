import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Megaphone, Plus } from 'lucide-react';
import { api, ApiError, HealthEvent } from '../lib/api';
import { btn, Card, EmptyState, field, SkeletonList } from './ui';

/** Kenya's date today (UTC+3), YYYY-MM-DD. */
function kenyaToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const deathsText = (n: number) => `${n} ${n === 1 ? 'death' : 'deaths'}`;
const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
const small = `${field.input} py-2`;

function RecordForm({ types, onSaved, onCancel }: { types: { code: string; label: string; immediate: boolean }[]; onSaved: (immediate: boolean) => void; onCancel: () => void }) {
  const [type, setType] = useState(types[0]?.code ?? 'ILLNESS_CLUSTER');
  const [detectedOn, setDetectedOn] = useState(kenyaToday());
  const [cases, setCases] = useState('');
  const [casesU5, setCasesU5] = useState('');
  const [deaths, setDeaths] = useState('');
  const [deathsU5, setDeathsU5] = useState('');
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDeath = type.endsWith('_DEATH');

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const values = [cases, casesU5, deaths, deathsU5].map(num);
    if (values.some((v) => !Number.isInteger(v) || v < 0)) {
      setError('Numbers must be whole numbers, 0 or more');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.recordHealthEvent({
        type,
        detectedOn,
        casesCount: values[0]!,
        casesUnder5: values[1]!,
        deathsCount: values[2]!,
        deathsUnder5: values[3]!,
        eventDescription: description.trim(),
        eventPlace: place.trim() || null,
      });
      onSaved(res.immediate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the event');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-2xl border border-slate-200 bg-cream-50 p-4">
      <label className="block">
        <span className={field.label}>What kind of event?</span>
        <select id="event-type" value={type} onChange={(e) => setType(e.target.value)} className={small}>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
              {t.immediate ? ' (report within 24 hours)' : ' (weekly report)'}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 block sm:col-span-1">
          <span className={field.label}>Date detected</span>
          <input id="event-date" type="date" max={kenyaToday()} value={detectedOn} onChange={(e) => setDetectedOn(e.target.value)} className={small} required />
        </label>
        {!isDeath && (
          <>
            <label className="block">
              <span className={field.label}>People affected</span>
              <input id="event-cases" inputMode="numeric" value={cases} onChange={(e) => setCases(e.target.value)} placeholder="0" className={small} />
            </label>
            <label className="block">
              <span className={field.label}>of them under 5</span>
              <input id="event-cases-u5" inputMode="numeric" value={casesU5} onChange={(e) => setCasesU5(e.target.value)} placeholder="0" className={small} />
            </label>
          </>
        )}
        <label className="block">
          <span className={field.label}>Deaths</span>
          <input id="event-deaths" inputMode="numeric" value={deaths} onChange={(e) => setDeaths(e.target.value)} placeholder="0" className={small} />
        </label>
        <label className="block">
          <span className={field.label}>Deaths under 5</span>
          <input id="event-deaths-u5" inputMode="numeric" value={deathsU5} onChange={(e) => setDeathsU5(e.target.value)} placeholder="0" className={small} />
        </label>
      </div>
      <label className="block">
        <span className={field.label}>Where (optional)</span>
        <input id="event-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Kawangware, a primary school" className={small} />
      </label>
      <label className="block">
        <span className={field.label}>What happened</span>
        <textarea
          id="event-description"
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Symptoms, when it started, anything shared (food, water, event, animals). No patient names."
          className={`${field.input} min-h-24 resize-y py-2`}
          required
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={btn.gold} disabled={busy}>
          {busy ? 'Saving…' : 'Record event'}
        </button>
      </div>
    </form>
  );
}

function ReportedButton({ ev, onDone }: { ev: HealthEvent; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>
        Mark as reported
      </button>
    );
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="block min-w-0 flex-1">
        <span className={field.label}>Who took the report? (optional)</span>
        <input id={`ev-note-${ev.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. SCDSC, by phone" className={small} />
      </label>
      <button
        type="button"
        className={btn.gold}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          api
            .markHealthEventReported(ev.id, note.trim())
            .then(onDone)
            .finally(() => setBusy(false));
        }}
      >
        Confirm reported
      </button>
    </div>
  );
}

/**
 * Public health events (event-based surveillance): clusters, deaths, AEFI
 * and other events a diagnosis can't capture. Counts only, never names.
 */
export function HealthEvents() {
  const [events, setEvents] = useState<HealthEvent[] | null>(null);
  const [types, setTypes] = useState<{ code: string; label: string; immediate: boolean }[]>([]);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listHealthEvents()
      .then((r) => {
        setEvents(r.events);
        setTypes(r.types);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load events'));
  }, []);
  useEffect(load, [load]);

  return (
    <Card
      title="Public health events"
      icon={Megaphone}
      bodyClassName="p-0"
      actions={
        !adding && (
          <button type="button" className={btn.secondary} onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Record an event
          </button>
        )
      }
    >
      <div className="space-y-3 px-5 pt-4">
        <p className="text-sm text-ink-500">
          For what a diagnosis can&apos;t show: a cluster of people or deaths with similar symptoms, sick animals, an adverse event after
          immunization, a maternal, neonatal or malaria death, or a food-borne, chemical or unknown event. Counts only, no patient names.
        </p>
        {saved && (
          <p role="status" className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {saved}
          </p>
        )}
        {adding && types.length > 0 && (
          <RecordForm
            types={types}
            onCancel={() => setAdding(false)}
            onSaved={(immediate) => {
              setAdding(false);
              setSaved(
                immediate
                  ? 'Event recorded. Report it to the Sub-County Disease Surveillance Coordinator within 24 hours, then mark it as reported. The clinic’s admins and doctors were sent an SMS reminder.'
                  : 'Event recorded. It is counted in this week’s summary.',
              );
              load();
            }}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      {!events && !error && <SkeletonList rows={2} label="Loading events" />}
      {events && events.length === 0 && <EmptyState icon={CheckCircle2} tone="success" title="No events recorded." />}
      {events && events.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {events.map((ev) => (
            <li key={ev.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">{ev.typeLabel}</p>
                  <p className="text-sm text-ink-700">
                    {ev.detectedOn}
                    {ev.eventPlace ? ` · ${ev.eventPlace}` : ''} · {ev.casesCount} affected ({ev.casesUnder5} under 5) · {deathsText(ev.deathsCount)} ({ev.deathsUnder5} under 5)
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{ev.eventDescription}</p>
                  <p className="text-xs text-ink-500">Recorded by {ev.recordedBy}</p>
                </div>
                {ev.immediate ? (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">Report within 24 hours</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-ink-700">Weekly report</span>
                )}
              </div>
              {ev.reportedAt ? (
                <p className="mt-2 flex items-start gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 size={15} aria-hidden className="mt-0.5 flex-none" />
                  Reported {new Date(ev.reportedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} by {ev.reportedBy}
                  {ev.reportNote ? `: ${ev.reportNote}` : ''}
                </p>
              ) : ev.immediate ? (
                <div className="mt-2">
                  <ReportedButton ev={ev} onDone={load} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
