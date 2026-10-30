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
      <SmsWarning />
      <MpesaWarning />
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

/** Red banner when SMS sending has failed several times in a row (Africa's Talking down, no credit, …). */
function SmsWarning() {
  const { data } = useLoad(() => api.smsHealth(), []);
  if (!data?.failing) return null;
  const since = data.failingSince ? new Date(data.failingSince).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div role="alert" className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      <strong>SMS sending is failing:</strong> {data.consecutiveFailures} failures in a row{since ? ` since ${since}` : ''}. Check
      Africa&apos;s Talking (credit, API key, service status). Patients can still use the portal; codes that can&apos;t be
      sent fall back to verification at the clinic. This warning clears after the next successful SMS.
    </div>
  );
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

/** C20: shown after 3 or more M-Pesa check-in prompts in a row fail or time out. */
function MpesaWarning() {
  const { data } = useLoad(() => api.mpesaHealth(), []);
  if (!data?.failing) return null;
  return (
    <div role="alert" className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      <strong>M-Pesa prompts are failing – check Daraja/Safaricom.</strong> {data.consecutiveFailures} prompts in a row failed or timed out
      {data.failingSince ? ` since ${dateTime(data.failingSince)}` : ''}. Last successful payment:{' '}
      {data.lastSuccessAt ? dateTime(data.lastSuccessAt) : 'none recorded yet'}. Patients are still checked in and queued; their fees
      are owed until paid. This warning clears after the next successful payment.
    </div>
  );
}
