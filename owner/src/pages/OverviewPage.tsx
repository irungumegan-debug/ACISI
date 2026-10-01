import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatKes } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { ErrorText, Loading, PageHeader } from '../components/ui';

function Stat({ label, value, detail, to }: { label: string; value: string; detail?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{value}</p>
      {detail && <p className="mt-1 text-sm text-stone-500">{detail}</p>}
    </>
  );
  const cls = 'block rounded-lg border border-stone-200 bg-white p-4';
  return to ? (
    <Link to={to} className={`${cls} hover:border-stone-400`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function OverviewPage() {
  const { data, error, loading } = useLoad(() => api.overview(), []);

  return (
    <>
      <PageHeader title="Overview" subtitle="Everything on the ACISI platform, across every clinic." />
      {loading && !data && <Loading />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Clinics"
            value={data.clinics.active.toLocaleString()}
            detail={`${data.clinics.total - data.clinics.active} deactivated`}
            to="/clinics"
          />
          <Stat
            label="Staff & doctors"
            value={data.staff.active.toLocaleString()}
            detail={`${data.staff.total - data.staff.active} deactivated`}
            to="/staff"
          />
          <Stat
            label="Patients"
            value={data.patients.active.toLocaleString()}
            detail={`${data.patients.deleted} deleted account${data.patients.deleted === 1 ? '' : 's'}`}
            to="/patients"
          />
          <Stat
            label="Visits"
            value={data.visits.total.toLocaleString()}
            detail={`${data.visits.last30Days} in the last 30 days`}
          />
          <Stat label="Upcoming appointments" value={data.upcomingAppointments.toLocaleString()} />
          <Stat
            label="Check-in fees collected"
            value={formatKes(data.revenueKes.total)}
            detail={`${formatKes(data.revenueKes.last30Days)} in the last 30 days`}
          />
        </div>
      )}
    </>
  );
}
