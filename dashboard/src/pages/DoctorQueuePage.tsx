import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DoctorPresenceStatus, DoctorQueueItem } from '../lib/api';
import { ArrowRight, Clock, Coffee, Hourglass, Stethoscope, UserRoundCheck } from 'lucide-react';
import { Avatar, Card, EmptyState, SkeletonList, StatusBadge } from '../components/ui';

function waited(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function DoctorQueuePage() {
  const [items, setItems] = useState<DoctorQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<DoctorPresenceStatus | null>(null);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [togglingPresence, setTogglingPresence] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getDoctorQueue()
      .then((res) => {
        if (!cancelled) {
          setItems(res.queue);
          setPresence(res.presence);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTogglePresence(): Promise<void> {
    const nextStatus = presence === 'IN' ? 'OUT' : 'IN';
    setTogglingPresence(true);
    setPresenceError(null);
    try {
      const result = await api.setOwnPresence(nextStatus);
      setPresence(result.presence);
    } catch (err) {
      setPresenceError(err instanceof ApiError ? err.message : 'Failed to update presence');
    } finally {
      setTogglingPresence(false);
    }
  }

  const current = items.filter((i) => i.status === 'IN_CONSULTATION');
  const waiting = items.filter((i) => i.status !== 'IN_CONSULTATION');

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Today&apos;s queue</h1>
          <p className="mt-1 text-sm text-ink-500">Only patients checked in to your department appear here.</p>
        </div>
      </div>

      {(presence === 'IN' || presence === 'OUT') && (
        <div
          className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
            presence === 'IN' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${presence === 'IN' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
              {presence === 'IN' ? <UserRoundCheck size={19} aria-hidden /> : <Coffee size={19} aria-hidden />}
            </span>
            <div>
              <p className={`text-sm font-semibold ${presence === 'IN' ? 'text-emerald-900' : 'text-amber-900'}`}>
                {presence === 'IN' ? "You're marked in today" : "You're marked out today"}
              </p>
              {presence === 'OUT' && <p className="text-xs text-amber-800">You won&apos;t receive new patient assignments while marked out.</p>}
              {presenceError && (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {presenceError}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => void handleTogglePresence()}
            disabled={togglingPresence}
            className="min-h-10 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:border-gold-500 disabled:opacity-50"
          >
            {togglingPresence ? 'Updating…' : presence === 'IN' ? 'Mark myself out for today' : 'Mark myself in for today'}
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonList rows={4} label="Loading your queue" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Stethoscope} tone="success" title="No patients waiting right now.">
            New check-ins for your department will appear here.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          {current.length > 0 && (
            <section aria-labelledby="now-seeing">
              <h2 id="now-seeing" className="mb-3 flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-ink-700">
                <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-teal-500" /> Now seeing
              </h2>
              <div className="space-y-3">
                {current.map((item) => (
                  <Link
                    key={item.encounterId}
                    to={`/doctor/encounters/${item.encounterId}`}
                    className="group relative flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-900 to-navy-950 p-5 text-white shadow-raised ring-1 ring-gold-500/40 sm:p-6"
                  >
                    <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-foil" />
                    <span aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold-400/15 blur-2xl" />
                    <Avatar name={item.patientName} size="lg" className="relative ring-2 ring-gold-400/60" />
                    <div className="relative min-w-0 flex-1">
                      <p className="truncate font-display text-2xl font-bold tracking-tight">{item.patientName}</p>
                      <p className="mt-0.5 text-sm text-slate-300">
                        {item.patientCode} · checked in {new Date(item.waitingSince).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </p>
                    </div>
                    <span className="btn-gold relative min-h-11 px-5 py-2.5 text-sm">
                      Open consultation <ArrowRight size={16} aria-hidden className="transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="up-next">
            <h2 id="up-next" className="mb-3 flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-ink-700">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Waiting
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-500 ring-1 ring-slate-200">{waiting.length}</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-ink-500">Nobody else is waiting.</p>
            ) : (
              <ol className="space-y-3">
                {waiting.map((item, i) => (
                  <li key={item.encounterId}>
                    <Link
                      to={`/doctor/encounters/${item.encounterId}`}
                      className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-500 hover:shadow-raised"
                    >
                      <span className="w-6 text-center font-display text-lg font-bold text-ink-400">{i + 1}</span>
                      <Avatar name={item.patientName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display font-semibold text-navy-900">{item.patientName}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-500">
                          {item.patientCode}
                          <span className="inline-flex items-center gap-1">
                            <Clock size={13} aria-hidden /> Waiting <strong className="text-navy-900">{waited(item.waitingSince, now)}</strong>
                          </span>
                        </p>
                      </div>
                      <span className="hidden sm:inline-flex">
                        <StatusBadge status={item.status} />
                      </span>
                      <Hourglass size={18} aria-hidden className="text-amber-600 sm:hidden" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
