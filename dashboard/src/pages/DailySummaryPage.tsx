import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Banknote, Building2, CalendarDays, CircleCheckBig, CreditCard, ReceiptText, Smartphone, Sigma, XCircle } from 'lucide-react';
import { api, ApiError, DailySummary } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BillStatusChip, kes } from './CheckoutPage';
import { Avatar, Card, EmptyState, field, Skeleton, StatCard } from '../components/ui';

/** Today's date in Kenya (UTC+3), YYYY-MM-DD. */
function kenyaToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/*
 * Series colours for the split-by-method chart (validated for colour-blind
 * separation; they sit under 3:1 on white, so every value is also printed
 * in the legend table below the bar).
 */
const METHOD_SERIES = [
  { key: 'cashKes', label: 'Cash', color: '#d4a83f', icon: Banknote },
  { key: 'cardKes', label: 'Card', color: '#2a78d6', icon: CreditCard },
  { key: 'mobileMoneyKes', label: 'Mobile money', color: '#1baf7a', icon: Smartphone },
] as const;

/** Part-to-whole: one stacked bar of the day's money by method, with a hover/focus readout and a legend table. */
function MethodSplit({ totals }: { totals: DailySummary['totals'] }) {
  const [active, setActive] = useState<string | null>(null);
  const total = totals.totalKes;
  if (total <= 0) {
    return <p className="py-2 text-sm text-ink-500">No money received on this day yet, so there&apos;s nothing to split.</p>;
  }
  const rows = METHOD_SERIES.map((m) => ({ ...m, amount: totals[m.key], pct: (totals[m.key] / total) * 100 })).filter((r) => r.amount > 0);
  let left = 0;

  return (
    <div>
      <div className="relative pt-7">
        {/* direct % labels over segments wide enough to hold them */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-6">
          {rows.map((r) => {
            const center = left + r.pct / 2;
            left += r.pct;
            return r.pct >= 12 ? (
              <span key={r.key} className="absolute -translate-x-1/2 text-xs font-semibold text-ink-700 tabular-nums" style={{ left: `${center}%` }}>
                {Math.round(r.pct)}%
              </span>
            ) : null;
          })}
        </div>
        <div className="flex h-5 gap-[2px]" role="list" aria-label="Money received by method">
          {rows.map((r) => (
            <div
              key={r.key}
              role="listitem"
              tabIndex={0}
              aria-label={`${r.label}: ${kes(r.amount)}, ${Math.round(r.pct)}%`}
              onPointerEnter={() => setActive(r.key)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(r.key)}
              onBlur={() => setActive(null)}
              className="relative h-full min-w-[6px] rounded-[4px] outline-offset-2 transition-opacity"
              style={{ width: `${r.pct}%`, background: r.color, opacity: active && active !== r.key ? 0.45 : 1 }}
            >
              {active === r.key && (
                <span className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-navy-900 px-3 py-2 text-xs text-white shadow-raised">
                  <strong className="block font-display text-sm text-gold-300">{kes(r.amount)}</strong>
                  {r.label} · {Math.round(r.pct)}%
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">Money received by payment method</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-ink-500">
            <th className="pb-2 font-semibold">Method</th>
            <th className="pb-2 text-right font-semibold">Amount</th>
            <th className="pb-2 text-right font-semibold">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {METHOD_SERIES.map((m) => {
            const amount = totals[m.key];
            return (
              <tr key={m.key} onPointerEnter={() => setActive(m.key)} onPointerLeave={() => setActive(null)}>
                <td className="py-2">
                  <span className="flex items-center gap-2.5 text-ink-700">
                    <span aria-hidden className="h-[3px] w-4 rounded-full" style={{ background: m.color }} />
                    {m.label}
                  </span>
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-navy-900">{kes(amount)}</td>
                <td className="py-2 text-right tabular-nums text-ink-500">{Math.round((amount / total) * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Money received per department — horizontal bars, every value printed beside its bar. */
function DepartmentTotals({ rows, total }: { rows: DailySummary['byDepartment']; total: number }) {
  if (rows.length === 0 || total <= 0) {
    return <p className="py-2 text-sm text-ink-500">No money received on this day yet.</p>;
  }
  const max = Math.max(...rows.map((r) => r.totalKes));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Money received by department</caption>
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-ink-500">
          <th className="pb-2 font-semibold">Department</th>
          <th className="hidden pb-2 font-semibold sm:table-cell">
            <span className="sr-only">Share</span>
          </th>
          <th className="pb-2 text-right font-semibold">Amount</th>
          <th className="pb-2 text-right font-semibold">Payments</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.departmentId}>
            <td className="py-2.5 pr-3">
              <span className="flex items-center gap-2">
                <span className="rounded-md bg-navy-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-gold-300">{r.code}</span>
                <span className="font-medium text-navy-900">{r.name}</span>
              </span>
            </td>
            <td className="hidden w-2/5 py-2.5 pr-3 sm:table-cell">
              <span aria-hidden className="block h-2.5 rounded-full bg-cream-100">
                <span className="block h-full rounded-full bg-gold-500" style={{ width: `${Math.max(3, (r.totalKes / max) * 100)}%` }} />
              </span>
            </td>
            <td className="py-2.5 text-right font-semibold tabular-nums text-navy-900">
              {kes(r.totalKes)}
              <span className="ml-1.5 text-xs font-normal text-ink-500">{Math.round((r.totalKes / total) * 100)}%</span>
            </td>
            <td className="py-2.5 text-right tabular-nums text-ink-500">{r.paymentCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Clinic admin: money in by method for a day, paid visits, and who still owes. */
export function DailySummaryPage() {
  const { session } = useAuth();
  const [date, setDate] = useState(kenyaToday());
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDailySummary(date)
      .then((s) => !cancelled && setSummary(s))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load the summary.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (session && session.role !== 'ADMIN') return <Navigate to="/queue" replace />;

  const isToday = date === kenyaToday();
  const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Daily summary</h1>
          <p className="mt-1 text-sm text-ink-500">Money received by the clinic at checkout. ACISI check-in fees aren&apos;t included.</p>
        </div>
        <label className="w-full text-sm sm:w-auto">
          <span className={`${field.label} flex items-center gap-1.5`}>
            <CalendarDays size={15} aria-hidden className="text-gold-700" /> Date
          </span>
          <input
            type="date"
            value={date}
            max={kenyaToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={`${field.input} text-base sm:w-52 sm:text-[15px]`}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && !summary && (
        <div role="status" aria-label="Loading the summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {summary && (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <p className="text-sm font-medium text-ink-700">{isToday ? `Today · ${dayLabel}` : dayLabel}</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {METHOD_SERIES.map((m) => (
              <StatCard key={m.key} label={m.label} value={kes(summary.totals[m.key])} icon={m.icon} accent={m.color} tone={m.key === 'cashKes' ? 'gold' : m.key === 'cardKes' ? 'blue' : 'success'} />
            ))}
            <StatCard hero label="Total" value={kes(summary.totals.totalKes)} icon={Sigma} />
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm text-emerald-900 ring-1 ring-emerald-200">
              <CircleCheckBig size={15} aria-hidden />
              <strong className="tabular-nums">{summary.paidVisitCount}</strong> visit{summary.paidVisitCount === 1 ? '' : 's'} fully paid
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm text-ink-700 ring-1 ring-slate-200">
              <ReceiptText size={15} aria-hidden className="text-gold-700" />
              <strong className="tabular-nums">{summary.paymentCount}</strong> payment{summary.paymentCount === 1 ? '' : 's'}
            </span>
            {summary.voidedCount > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm text-ink-500 ring-1 ring-slate-200">
                <XCircle size={15} aria-hidden />
                <strong className="tabular-nums">{summary.voidedCount}</strong> voided
              </span>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card title="Split by method" icon={Banknote}>
              <MethodSplit totals={summary.totals} />
            </Card>

            <Card title={`Unpaid & partly paid (${summary.outstanding.length})`} icon={ReceiptText} bodyClassName="">
              {summary.outstanding.length === 0 ? (
                <EmptyState icon={CircleCheckBig} tone="success" title="Everyone seen on this day has paid in full." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.outstanding.map((o) => (
                    <li key={o.encounterId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-cream-50">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={o.patientName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-navy-900">{o.patientName}</p>
                          <p className="text-xs text-ink-500">
                            {o.patientCode} · {new Date(o.visitedAt).toLocaleTimeString('en-KE', { timeStyle: 'short' })}
                            {o.totalKes !== null && ` · total ${kes(o.totalKes)}, paid ${kes(o.paidKes)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {o.balanceKes !== null && <span className="text-sm font-bold tabular-nums text-red-700">{kes(o.balanceKes)} due</span>}
                        <BillStatusChip status={o.billStatus === 'NO_BILL' ? null : o.billStatus} />
                        <Link
                          to={`/checkout/${o.encounterId}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-slate-300 px-3.5 py-1 text-xs font-semibold text-navy-900 hover:border-gold-500"
                        >
                          Open <ArrowRight size={13} aria-hidden />
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {summary.departmentCount > 1 && (
            <Card title="By department" icon={Building2}>
              <DepartmentTotals rows={summary.byDepartment} total={summary.totals.totalKes} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
