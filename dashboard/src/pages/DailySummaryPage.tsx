import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError, DailySummary } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BillStatusChip, kes } from './CheckoutPage';

/** Today's date in Kenya (UTC+3), YYYY-MM-DD. */
function kenyaToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  const tiles = summary
    ? [
        ['Cash', summary.totals.cashKes],
        ['Card', summary.totals.cardKes],
        ['Mobile money', summary.totals.mobileMoneyKes],
        ['Total', summary.totals.totalKes],
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Daily summary</h1>
          <p className="text-sm text-slate-500">Money received by the clinic at checkout. ACISI check-in fees aren&apos;t included.</p>
        </div>
        <label className="text-sm text-slate-700">
          <span className="mb-1 block font-medium">Date</span>
          <input
            type="date"
            value={date}
            max={kenyaToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-base sm:text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && !summary && <p className="text-sm text-slate-500">Loading…</p>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(([labelText, amount]) => (
              <div key={labelText} className={`rounded-lg border p-4 ${labelText === 'Total' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{labelText}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{kes(amount as number)}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{summary.paidVisitCount}</span> visit{summary.paidVisitCount === 1 ? '' : 's'} fully paid ·{' '}
            {summary.paymentCount} payment{summary.paymentCount === 1 ? '' : 's'}
            {summary.voidedCount > 0 && ` · ${summary.voidedCount} voided`}
          </p>

          <section className="rounded-lg border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Unpaid &amp; partly paid ({summary.outstanding.length})</h2>
            {summary.outstanding.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Everyone seen on this day has paid in full.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.outstanding.map((o) => (
                  <li key={o.encounterId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{o.patientName}</p>
                      <p className="text-xs text-slate-500">
                        {o.patientCode} · {new Date(o.visitedAt).toLocaleTimeString('en-KE', { timeStyle: 'short' })}
                        {o.totalKes !== null && ` · total ${kes(o.totalKes)}, paid ${kes(o.paidKes)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.balanceKes !== null && <span className="text-sm font-semibold tabular-nums text-red-700">{kes(o.balanceKes)} due</span>}
                      <BillStatusChip status={o.billStatus === 'NO_BILL' ? null : o.billStatus} />
                      <Link to={`/checkout/${o.encounterId}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-500">
                        Open
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
