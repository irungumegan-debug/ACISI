import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatKes } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { ErrorText, Loading, PageHeader } from '../components/ui';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Building2, CalendarDays, ClipboardList, HardDrive, Stethoscope, UsersRound, Wallet } from 'lucide-react';

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
/** 1536 -> "1.5 KB", 3.2e9 -> "3.0 GB". */
function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} bytes` : `${n.toFixed(1)} ${units[i]}`;
}

/** "3.0 GB of files · disk 62% full, 18.4 GB free" — amber once the disk is 80% full. */
function storageStat(s: { filesBytes: number; fileCount: number; disk: { totalBytes: number; freeBytes: number } | null }) {
  if (!s.disk) return { value: formatBytes(s.filesBytes), detail: `${s.fileCount.toLocaleString()} files · disk size unknown`, tone: 'teal' as const };
  const usedPct = Math.round(((s.disk.totalBytes - s.disk.freeBytes) / s.disk.totalBytes) * 100);
  return {
    value: formatBytes(s.filesBytes),
    detail: `${s.fileCount.toLocaleString()} files · server disk ${usedPct}% full, ${formatBytes(s.disk.freeBytes)} free${usedPct >= 80 ? ' — time to upgrade the disk' : ''}`,
    tone: usedPct >= 80 ? ('amber' as const) : ('teal' as const),
  };
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
          <Stat icon={HardDrive} label="Uploaded files" {...storageStat(data.storage)} />
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
