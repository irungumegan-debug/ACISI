import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatKes } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { ErrorText, Loading, PageHeader } from '../components/ui';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Building2, CalendarDays, ClipboardList, Stethoscope, UsersRound, Wallet } from 'lucide-react';

const TONES = {
  gold: { strip: 'bg-gold-500', circle: 'bg-gold-tint text-gold-700' },
  blue: { strip: 'bg-blue-500', circle: 'bg-blue-50 text-blue-700' },
  teal: { strip: 'bg-teal-500', circle: 'bg-teal-50 text-teal-700' },
  emerald: { strip: 'bg-emerald-500', circle: 'bg-emerald-50 text-emerald-700' },
  amber: { strip: 'bg-amber-500', circle: 'bg-amber-50 text-amber-700' },
};

function Stat({
  label,
  value,
  detail,
  to,
  icon: Icon,
  tone = 'gold',
  hero = false,
}: {
  label: string;
  value: string;
  detail?: string;
  to?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  hero?: boolean;
}) {
  const t = TONES[tone];
  const body = (
    <>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${hero ? 'bg-foil' : t.strip}`} />
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-medium ${hero ? 'text-stone-300' : 'text-ink-500'}`}>{label}</p>
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${hero ? 'bg-foil text-navy-900' : t.circle}`}>
          <Icon size={19} aria-hidden />
        </span>
      </div>
      <p className={`mt-2 font-display text-3xl font-bold tracking-tight tabular-nums ${hero ? 'text-gold-300' : 'text-navy-900'}`}>{value}</p>
      {detail && <p className={`mt-1 text-sm ${hero ? 'text-stone-300' : 'text-ink-500'}`}>{detail}</p>}
      {to && (
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-700">
          View <ArrowRight size={14} aria-hidden />
        </span>
      )}
    </>
  );
  const cls = hero
    ? 'relative block overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-900 to-navy-950 p-5 text-white shadow-raised ring-1 ring-gold-500/40'
    : 'relative block overflow-hidden rounded-2xl border border-stone-200/80 bg-white p-5 shadow-card';
  return to ? (
    <Link to={to} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-raised`}>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            icon={Building2}
            tone="gold"
            label="Clinics"
            value={data.clinics.active.toLocaleString()}
            detail={`${data.clinics.total - data.clinics.active} deactivated`}
            to="/clinics"
          />
          <Stat
            icon={Stethoscope}
            tone="blue"
            label="Doctors"
            value={data.doctors.active.toLocaleString()}
            detail={`${data.staff.active - data.doctors.active} front desk & admin staff`}
          />
          <Stat
            icon={UsersRound}
            tone="teal"
            label="Registered patients"
            value={data.patients.active.toLocaleString()}
            detail={`${data.patients.deleted} deleted account${data.patients.deleted === 1 ? '' : 's'}`}
          />
          <Stat
            icon={ClipboardList}
            tone="emerald"
            label="Visits"
            value={data.visits.total.toLocaleString()}
            detail={`${data.visits.last30Days} in the last 30 days`}
          />
          <Stat icon={CalendarDays} tone="amber" label="Upcoming appointments" value={data.upcomingAppointments.toLocaleString()} />
          <Stat
            hero
            icon={Wallet}
            label="Revenue (check-in fees)"
            value={formatKes(data.revenueKes.total)}
            detail={`${formatKes(data.revenueKes.last30Days)} in the last 30 days`}
          />
        </div>
      )}
    </>
  );
}
