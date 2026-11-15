import { useEffect, useState } from 'react';
import { Activity, Download, FileBarChart, FlaskConical, Pill, ShieldAlert, Stethoscope, UsersRound } from 'lucide-react';
import { api, ApiError, CountRow, RoutineReport } from '../lib/api';
import { btn, Card, field, SkeletonList, StatCard } from '../components/ui';
import { plural } from '../lib/plural';

type Period = 'MONTH' | 'QUARTER' | 'YEAR';

/** Kenya time now (UTC+3). */
const kenyaNow = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

/** Default value for each period: the last complete one. */
function lastFull(period: Period): string {
  const k = kenyaNow();
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();
  if (period === 'MONTH') return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 7);
  if (period === 'QUARTER') {
    const q = Math.floor(m / 3); // current quarter, 0-based
    return q === 0 ? `${y - 1}-Q4` : `${y}-Q${q}`;
  }
  return String(y - 1);
}

function options(period: Period): { value: string; label: string }[] {
  const k = kenyaNow();
  const y = k.getUTCFullYear();
  const out: { value: string; label: string }[] = [];
  if (period === 'MONTH') {
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(y, k.getUTCMonth() - i, 1));
      out.push({ value: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + (i === 0 ? ' (so far)' : '') });
    }
  } else if (period === 'QUARTER') {
    const cq = Math.floor(k.getUTCMonth() / 3) + 1;
    for (let i = 0; i < 8; i++) {
      const idx = y * 4 + (cq - 1) - i;
      const yy = Math.floor(idx / 4);
      const q = (idx % 4) + 1;
      out.push({ value: `${yy}-Q${q}`, label: `Q${q} ${yy}${i === 0 ? ' (so far)' : ''}` });
    }
  } else {
    for (let i = 0; i < 4; i++) out.push({ value: String(y - i), label: String(y - i) + (i === 0 ? ' (so far)' : '') });
  }
  return out;
}

function List({ rows, empty }: { rows: CountRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex justify-between gap-3 py-1.5">
          <span className="min-w-0 text-ink-700">{r.label}</span>
          <span className="font-semibold tabular-nums text-navy-900">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Monthly, quarterly and annual reports: clinic activity and the IDSR monthly diseases. Counts only. */
export function RoutineReportsPage() {
  const [period, setPeriod] = useState<Period>('MONTH');
  const [value, setValue] = useState(lastFull('MONTH'));
  const [report, setReport] = useState<RoutineReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api
      .routineReport(period, value)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Failed to load the report'));
    return () => {
      cancelled = true;
    };
  }, [period, value]);

  return (
    <div className="space-y-6">
      <Card
        title="Routine reports"
        icon={FileBarChart}
        actions={
          <a href={api.routineReportCsvUrl(period, value)} className={btn.secondary} download>
            <Download size={16} aria-hidden /> CSV
          </a>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Report period" className="flex gap-1 rounded-full bg-cream-100 p-1">
            {(['MONTH', 'QUARTER', 'YEAR'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => {
                  setPeriod(p);
                  setValue(lastFull(p));
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${period === p ? 'bg-navy-900 text-white' : 'text-ink-700'}`}
              >
                {p === 'MONTH' ? 'Monthly' : p === 'QUARTER' ? 'Quarterly' : 'Annual'}
              </button>
            ))}
          </div>
          <label className="block">
            <span className={field.label}>Period</span>
            <select id="report-period" value={value} onChange={(e) => setValue(e.target.value)} className={`${field.input} py-2`}>
              {options(period).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Counts only: no patient names. Disease counts come from ICD-11 diagnoses signed at this clinic. The IDSR monthly list follows the Kenya
          IDSR Technical Guidelines, 3rd edition (MOH, 2022).
        </p>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!report && !error && <SkeletonList rows={4} label="Loading the report" />}

      {report && (
        <>
          <p className="font-display text-xl font-semibold text-navy-900">
            {report.clinicName} · {report.label}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Visits" value={report.visits.total} icon={Activity} hint={`${report.visits.completed} completed`} />
            <StatCard label="Patients seen" value={report.patients.seen} icon={UsersRound} hint={`${report.patients.newToClinic} new · ${report.patients.returning} returning`} tone="info" />
            <StatCard label="Walk-in / remote" value={`${report.visits.walkIn} / ${report.visits.remote}`} icon={UsersRound} tone="blue" />
            <StatCard label="Lab requests" value={report.lab.ordersRequested} icon={FlaskConical} hint={`${report.lab.abnormal} abnormal · ${report.lab.critical} critical`} tone="success" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Patients by sex">
              <List rows={report.bySex} empty="No patients in this period." />
            </Card>
            <Card title="Patients by age">
              <List rows={report.byAge} empty="No patients in this period." />
            </Card>
            <Card title="Visits by department">
              <List rows={report.byDepartment} empty="No visits in this period." />
            </Card>
          </div>

          <Card title="Top diagnoses (ICD-11)" icon={Stethoscope}>
            {report.topDiagnoses.length === 0 ? (
              <p className="text-sm text-ink-500">No coded diagnoses in this period.</p>
            ) : (
              <ol className="divide-y divide-slate-100 text-sm">
                {report.topDiagnoses.map((d) => (
                  <li key={d.code} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 text-ink-700">
                      <span className="font-mono font-semibold text-teal-800">{d.code}</span> {d.title}
                    </span>
                    <span className="font-semibold tabular-nums text-navy-900">{d.count}</span>
                  </li>
                ))}
              </ol>
            )}
            {report.visitsWithoutCodes > 0 && (
              <p className="mt-2 text-xs text-ink-500">{report.visitsWithoutCodes === 1 ? '1 visit was' : `${report.visitsWithoutCodes} visits were`} signed before ICD-11 coding and aren&apos;t counted here.</p>
            )}
          </Card>

          <Card title="IDSR monthly reportable diseases" icon={ShieldAlert} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-ink-500">
                    <th className="px-5 py-2 font-semibold">Disease</th>
                    <th className="px-3 py-2 text-right font-semibold">Under 5</th>
                    <th className="px-3 py-2 text-right font-semibold">5 and over</th>
                    <th className="px-3 py-2 text-right font-semibold">Age unknown</th>
                    <th className="px-5 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.monthlyDiseases.map((d) => (
                    <tr key={d.id} className={`border-b border-slate-100 ${d.total > 0 ? 'font-semibold text-navy-900' : 'text-ink-500'}`}>
                      <td className="px-5 py-2">
                        {d.name}
                        {d.note && <span className="block text-xs font-normal text-amber-800">{d.note}</span>}
                      </td>
                      {d.countedByAcisi ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{d.under5}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{d.fiveAndOver}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{d.ageUnknown}</td>
                          <td className="px-5 py-2 text-right tabular-nums">{d.total}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="px-5 py-2 text-right text-xs italic text-amber-800">
                          count by hand
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-xs text-ink-500">
              &quot;New cases&quot; count a patient the first time they get that diagnosis at this clinic. Deaths aren&apos;t recorded on visits;
              recorded deaths are under Public health events.
            </p>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Prescriptions" icon={Pill}>
              <p className="mb-2 text-sm text-ink-700">
                {plural(report.prescriptions.visitsWithPrescription, 'visit')} with a prescription · {plural(report.prescriptions.medicineLines, 'medicine line')}
              </p>
              <List rows={report.prescriptions.topMedicines} empty="No structured prescriptions in this period." />
            </Card>
            <Card title="Notifiable diseases" icon={ShieldAlert}>
              <p className="mb-2 text-sm text-ink-700">
                {report.notifiable.immediate} immediately reportable · {report.notifiable.weekly} weekly
              </p>
              <List rows={report.notifiable.byDisease} empty="None in this period." />
            </Card>
            <Card title="Public health events" icon={ShieldAlert}>
              <p className="mb-2 text-sm text-ink-700">
                {plural(report.events.total, 'event')} · {report.events.cases} affected · {plural(report.events.deaths, 'death')}
              </p>
              <List rows={report.events.byType} empty="None in this period." />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
