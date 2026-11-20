import { FormEvent, useEffect, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { api, ApiError, VitalSignsSet } from '../lib/api';
import { btn, Card, field } from './ui';

type Key = 'systolic' | 'diastolic' | 'pulse' | 'respiratoryRate' | 'temperatureC' | 'oxygenSaturation' | 'weightKg' | 'heightCm' | 'muacCm';

const INPUTS: { key: Key; label: string; unit: string; step: string }[] = [
  { key: 'systolic', label: 'BP systolic', unit: 'mmHg', step: '1' },
  { key: 'diastolic', label: 'BP diastolic', unit: 'mmHg', step: '1' },
  { key: 'pulse', label: 'Pulse', unit: '/min', step: '1' },
  { key: 'respiratoryRate', label: 'Breathing rate', unit: '/min', step: '1' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1' },
  { key: 'oxygenSaturation', label: 'Oxygen (SpO₂)', unit: '%', step: '1' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
  { key: 'muacCm', label: 'MUAC (children)', unit: 'cm', step: '0.1' },
];

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function vitalsSummary(v: VitalSignsSet): string {
  const parts: string[] = [];
  if (v.systolic != null && v.diastolic != null) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulse != null) parts.push(`Pulse ${v.pulse}`);
  if (v.respiratoryRate != null) parts.push(`RR ${v.respiratoryRate}`);
  if (v.temperatureC != null) parts.push(`${v.temperatureC} °C`);
  if (v.oxygenSaturation != null) parts.push(`SpO₂ ${v.oxygenSaturation}%`);
  if (v.weightKg != null) parts.push(`${v.weightKg} kg`);
  if (v.heightCm != null) parts.push(`${v.heightCm} cm`);
  if (v.bmi != null) parts.push(`BMI ${v.bmi}`);
  if (v.muacCm != null) parts.push(`MUAC ${v.muacCm}`);
  return parts.join(' · ');
}

/** Weight over time (and BMI for adults), oldest to newest: a simple growth/trend line. */
function Trend({ sets }: { sets: VitalSignsSet[] }) {
  const points = [...sets].filter((s) => s.weightKg != null).reverse();
  if (points.length < 2) return null;
  const w = 320;
  const h = 90;
  const values = points.map((p) => p.weightKg!);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = points.map((p, i) => [12 + (i * (w - 24)) / (points.length - 1), h - 14 - ((p.weightKg! - min) / span) * (h - 28)] as const);
  return (
    <figure className="mt-3">
      <figcaption className="mb-1 text-xs font-semibold text-ink-700">Weight over time (kg)</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full max-w-sm" role="img" aria-label={`Weight from ${values[0]} to ${values[values.length - 1]} kg over ${points.length} visits`}>
        <polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" className="text-navy-700" />
        {xy.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" className="fill-gold-500" />
            <text x={x} y={y - 7} textAnchor="middle" className="fill-ink-700 text-[9px]">
              {values[i]}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[11px] text-ink-500">
        {fmtDate(points[0]!.recordedAt)} to {fmtDate(points[points.length - 1]!.recordedAt)}
      </p>
    </figure>
  );
}

/** Vital signs for a visit: record a set, see warnings (age-adjusted), earlier readings and the weight trend. */
export function VitalSignsCard({ encounterId, editable }: { encounterId: string; editable: boolean }) {
  const [data, setData] = useState<{ thisVisit: VitalSignsSet[]; history: VitalSignsSet[] } | null>(null);
  const [form, setForm] = useState<Partial<Record<Key, string>>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getVitalSigns(encounterId)
      .then(setData)
      .catch(() => setData({ thisVisit: [], history: [] }));
  }, [encounterId]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const values = Object.fromEntries(INPUTS.map(({ key }) => [key, form[key] ? Number(form[key]) : null]));
    try {
      setData(await api.recordVitalSigns(encounterId, values));
      setForm({});
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const all = [...data.thisVisit, ...data.history];

  return (
    <Card
      title="Vital signs"
      icon={Activity}
      className="mb-6"
      actions={
        editable && !open ? (
          <button type="button" className={btn.ghost} onClick={() => setOpen(true)}>
            + Record vitals
          </button>
        ) : undefined
      }
    >
      {data.thisVisit.length === 0 && !open && <p className="text-sm text-ink-500">None recorded for this visit yet.</p>}
      {data.thisVisit.map((v) => (
        <div key={v.id} className="mb-3">
          <p className="text-sm font-medium text-navy-900">{vitalsSummary(v)}</p>
          <p className="text-xs text-ink-500">
            {fmtTime(v.recordedAt)}, {v.recordedByName}
          </p>
          {v.warnings.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-label="Warnings">
              {v.warnings.map((w, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${w.level === 'danger' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}
                >
                  <AlertTriangle size={15} aria-hidden className="mt-0.5 flex-none" />
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {editable && open && (
        <form onSubmit={(e) => void save(e)} className="mt-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {INPUTS.map((i) => (
              <div key={i.key}>
                <label className={field.label} htmlFor={`vital-${i.key}`}>
                  {i.label} <span className="font-normal text-ink-500">({i.unit})</span>
                </label>
                <input
                  id={`vital-${i.key}`}
                  className={field.input}
                  type="number"
                  inputMode="decimal"
                  step={i.step}
                  value={form[i.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [i.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">Fill in only what you measured. BMI is worked out from weight and height.</p>
          {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={btn.primary} disabled={busy}>
              {busy ? 'Saving…' : 'Save vitals'}
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}

      {data.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-navy-900">Earlier visits ({data.history.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {data.history.slice(0, 10).map((v) => (
              <li key={v.id} className="flex flex-col sm:flex-row sm:gap-3">
                <span className="w-28 flex-none text-xs text-ink-500">{fmtDate(v.recordedAt)}</span>
                <span className="text-ink-700">{vitalsSummary(v)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Trend sets={all} />
    </Card>
  );
}
