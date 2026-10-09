import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Footprints,
  Globe,
  Hourglass,
  Plus,
  Repeat2,
  ReceiptText,
  Settings,
  Stethoscope,
  UsersRound,
  Wallet,
  XCircle,
} from 'lucide-react';
import { api, ApiError, CheckoutDeliveryMethod, QueueItem, subscribeToQueue } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar, Badge, btn, Card, EmptyState, SkeletonList, StatCard, StatusBadge, WalkInBadge } from '../components/ui';
import { ChangeDoctorDialog } from '../components/ChangeDoctorDialog';
import { ConfirmFeeDialog } from '../components/ConfirmFeeDialog';

/** Payment isn't resolved (still pending, failed, or unknown and awaiting a manual check) — the encounter, if any, hasn't started yet. */
function isUnresolvedPayment(item: QueueItem): boolean {
  return item.checkInStatus === 'PENDING_PAYMENT' || isPaymentProblem(item);
}

/** Kept out of the main queue, in "Payment didn't go through": failed, or no answer from M-Pesa within an hour. */
function isPaymentProblem(item: QueueItem): boolean {
  return item.checkInStatus === 'FAILED' || item.checkInStatus === 'NEEDS_REVIEW';
}

function displayStatus(item: QueueItem): string {
  return isUnresolvedPayment(item) ? item.checkInStatus : (item.encounterStatus ?? 'WAITING');
}

type GroupKey = 'ATTENTION' | 'WAITING' | 'IN_CONSULTATION' | 'READY_FOR_CHECKOUT' | 'DONE';

const GROUPS: { key: GroupKey; label: string; icon: LucideIcon; dot: string; empty: string }[] = [
  { key: 'ATTENTION', label: 'Check-in fee to confirm', icon: AlertTriangle, dot: 'bg-red-500', empty: '' },
  { key: 'WAITING', label: 'Waiting', icon: Hourglass, dot: 'bg-amber-500', empty: 'Nobody is waiting right now.' },
  { key: 'IN_CONSULTATION', label: 'In consultation', icon: Stethoscope, dot: 'bg-teal-500', empty: 'Nobody is with a doctor right now.' },
  { key: 'READY_FOR_CHECKOUT', label: 'Ready for checkout', icon: Wallet, dot: 'bg-blue-500', empty: 'Nobody is waiting to check out.' },
  { key: 'DONE', label: 'Done today', icon: CheckCircle2, dot: 'bg-emerald-500', empty: '' },
];

function groupOf(item: QueueItem): GroupKey {
  if (isUnresolvedPayment(item)) return 'ATTENTION';
  return (item.encounterStatus ?? 'WAITING') as GroupKey;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function waited(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}

const CHECK_IN_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting fee',
  FAILED: 'Fee payment failed',
  NEEDS_REVIEW: 'Check M-Pesa SMS',
};

export function QueuePage() {
  const { session } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<{ walkIn: number; remote: number } | null>(null);
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(false);
  const [deliveryChoice, setDeliveryChoice] = useState<Record<string, CheckoutDeliveryMethod>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [changingDoctor, setChangingDoctor] = useState<QueueItem | null>(null);
  const [confirmingFee, setConfirmingFee] = useState<QueueItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'status' | 'department'>(() => {
    try {
      return window.localStorage.getItem('acisi.queue.groupBy') === 'department' ? 'department' : 'status';
    } catch {
      return 'status';
    }
  });
  const isFrontDesk = session?.role !== 'DOCTOR';

  const refresh = useCallback(() => {
    // Counts are a nice-to-have: a failure there never blocks the queue itself.
    api.getTodayCheckInCounts().then(setCounts, () => setCounts(null));
    return api.getTodayCheckIns().then((res) => {
      setItems(res.checkIns);
      setEmailDeliveryAvailable(res.emailDeliveryAvailable);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const unsubscribe = subscribeToQueue(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  // Keeps "time waited" current without refetching.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleCheckout(checkInId: string): Promise<void> {
    setBusyId(checkInId);
    setError(null);
    try {
      await api.checkoutCheckIn(checkInId, deliveryChoice[checkInId] ?? 'sms');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to check out');
    } finally {
      setBusyId(null);
    }
  }

  // A failed check-in fee doesn't mean the patient is waiting: those sit in
  // their own collapsed section below the queue, not in it. (The server
  // already drops ones where the patient checked in again and paid.)
  const queueItems = useMemo(() => items.filter((i) => !isPaymentProblem(i)), [items]);
  const failedItems = useMemo(() => items.filter(isPaymentProblem), [items]);

  /** Departments present in today's queue, with how many patients each has. */
  const departmentsInQueue = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string | null; count: number }>();
    for (const item of queueItems) {
      const entry = map.get(item.departmentId) ?? { id: item.departmentId, name: item.departmentName, code: item.departmentCode, count: 0 };
      entry.count += 1;
      map.set(item.departmentId, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [queueItems]);
  // A filter for a department that has left the queue falls back to everyone.
  const activeFilter = deptFilter !== 'all' && departmentsInQueue.some((d) => d.id === deptFilter) ? deptFilter : 'all';
  const visible = useMemo(
    () => (activeFilter === 'all' ? queueItems : queueItems.filter((i) => i.departmentId === activeFilter)),
    [queueItems, activeFilter],
  );
  const visibleFailed = activeFilter === 'all' ? failedItems : failedItems.filter((i) => i.departmentId === activeFilter);
  const showDepartmentTools = departmentsInQueue.length > 1;

  const grouped = useMemo(() => {
    const map = new Map<GroupKey, QueueItem[]>(GROUPS.map((g) => [g.key, []]));
    for (const item of visible) map.get(groupOf(item))?.push(item);
    return map;
  }, [visible]);
  const count = (key: GroupKey) => grouped.get(key)?.length ?? 0;
  const paidToday = visible.filter((i) => i.billStatus === 'PAID').length;
  const statusOrder = (item: QueueItem) => GROUPS.findIndex((g) => g.key === groupOf(item));

  function chooseGroupBy(value: 'status' | 'department') {
    setGroupBy(value);
    try {
      window.localStorage.setItem('acisi.queue.groupBy', value);
    } catch {
      // Storage blocked — the choice just isn't remembered.
    }
  }

  function renderCard(item: QueueItem) {
    return (
      <QueueCard
        key={item.checkInId}
        item={item}
        now={now}
        isFrontDesk={isFrontDesk}
        busy={busyId === item.checkInId}
        emailDeliveryAvailable={emailDeliveryAvailable}
        delivery={deliveryChoice[item.checkInId] ?? 'sms'}
        onDelivery={(value) => setDeliveryChoice((prev) => ({ ...prev, [item.checkInId]: value }))}
        onConfirmPayment={() => {
          setNotice(null);
          setConfirmingFee(item);
        }}
        onCheckout={() => void handleCheckout(item.checkInId)}
        onChangeDoctor={() => {
          setNotice(null);
          setChangingDoctor(item);
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Today&apos;s queue</h1>
          {counts && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              <Badge tone="gold" icon={Footprints}>
                {counts.walkIn} walk-in
              </Badge>
              <Badge tone="blue" icon={Globe}>
                {counts.remote} remote
              </Badge>
              <span className="sr-only">
                Today: {counts.walkIn} walk-in, {counts.remote} remote
              </span>
            </p>
          )}
        </div>
        {isFrontDesk && (
          <Link to="/walk-in" className={`${btn.gold} w-full px-6 text-[15px] sm:w-auto`}>
            <Plus size={19} aria-hidden strokeWidth={2.6} /> Check in walk-in patient
          </Link>
        )}
      </div>

      {!loading && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Waiting" value={count('WAITING')} icon={Hourglass} tone="warning" />
          <StatCard label="In consultation" value={count('IN_CONSULTATION')} icon={Stethoscope} tone="info" />
          <StatCard label="Ready for checkout" value={count('READY_FOR_CHECKOUT')} icon={Wallet} tone="blue" />
          <StatCard label="Paid today" value={paidToday} icon={ReceiptText} tone="success" hint={`${count('DONE')} visits done`} />
        </div>
      )}

      {session?.role === 'ADMIN' && (
        <nav aria-label="Admin shortcuts" className="mb-6 flex flex-wrap gap-2">
          {[
            { to: '/reports/daily', label: 'Daily summary', icon: BarChart3 },
            { to: '/settings', label: 'Departments & payments', icon: Settings },
            { to: '/settings', label: 'Staff & doctors', icon: UsersRound },
          ].map((l) => (
            <Link
              key={l.label}
              to={l.to}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-900 shadow-sm transition hover:border-gold-500 hover:bg-gold-tint/50"
            >
              <l.icon size={16} aria-hidden className="text-gold-700" /> {l.label}
            </Link>
          ))}
        </nav>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {notice}
        </p>
      )}
      {confirmingFee && (
        <ConfirmFeeDialog
          checkInId={confirmingFee.checkInId}
          patientName={confirmingFee.patientName}
          amountKes={confirmingFee.amountKes}
          onClose={() => setConfirmingFee(null)}
          onConfirmed={() => {
            setNotice(`Check-in fee confirmed for ${confirmingFee.patientName}.`);
            setConfirmingFee(null);
            void refresh();
          }}
        />
      )}
      {changingDoctor && (
        <ChangeDoctorDialog
          checkInId={changingDoctor.checkInId}
          patientName={changingDoctor.patientName}
          onClose={() => setChangingDoctor(null)}
          onChanged={(doctorName) => {
            setNotice(`${changingDoctor.patientName} moved to ${doctorName}.`);
            setChangingDoctor(null);
            void refresh();
          }}
        />
      )}

      {!loading && showDepartmentTools && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filter by department" className="flex flex-wrap gap-2">
            {[{ id: 'all', name: 'All departments', code: null, count: queueItems.length }, ...departmentsInQueue].map((d) => {
              const on = activeFilter === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDeptFilter(d.id)}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    on ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-navy-900 hover:border-gold-500'
                  }`}
                >
                  {d.name}
                  <span className={`rounded-full px-1.5 text-xs font-semibold ${on ? 'bg-white/15 text-gold-300' : 'bg-cream-100 text-ink-500'}`}>{d.count}</span>
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Group cards by" className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm">
            {(['status', 'department'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={groupBy === value}
                onClick={() => chooseGroupBy(value)}
                className={`min-h-8 rounded-full px-3.5 font-medium transition ${groupBy === value ? 'bg-gold-500 text-navy-900' : 'text-ink-500 hover:text-navy-900'}`}
              >
                {value === 'status' ? 'By status' : 'By department'}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonList rows={5} label="Loading the queue" />
      ) : queueItems.length === 0 ? (
        <Card>
          <EmptyState icon={UsersRound} title="No check-ins yet today" tone="gold">
            Patients who check in online, and walk-ins you add, will appear here.
          </EmptyState>
        </Card>
      ) : groupBy === 'department' && showDepartmentTools ? (
        <div className="space-y-8">
          {departmentsInQueue
            .filter((d) => activeFilter === 'all' || d.id === activeFilter)
            .map((d) => {
              const list = visible.filter((i) => i.departmentId === d.id).sort((a, b) => statusOrder(a) - statusOrder(b));
              return (
                <section key={d.id} aria-labelledby={`dept-${d.id}`}>
                  <h2 id={`dept-${d.id}`} className="mb-3 flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-ink-700">
                    {d.code && <span className="rounded-md bg-navy-900 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-gold-300">{d.code}</span>}
                    {d.name}
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-500 ring-1 ring-slate-200">{list.length}</span>
                  </h2>
                  <ul className="grid gap-3 xl:grid-cols-2">{list.map(renderCard)}</ul>
                </section>
              );
            })}
        </div>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const list = grouped.get(group.key) ?? [];
            if (list.length === 0 && !group.empty) return null;
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`}>
                <h2 id={`group-${group.key}`} className="mb-3 flex items-center gap-2.5 text-sm font-semibold uppercase tracking-wider text-ink-700">
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${group.dot}`} />
                  {group.label}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-500 ring-1 ring-slate-200">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-ink-500">{group.empty}</p>
                ) : (
                  <ul className="grid gap-3 xl:grid-cols-2">{list.map(renderCard)}</ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!loading && visibleFailed.length > 0 && (
        <details className="group mt-8 rounded-2xl border border-slate-200 bg-cream-50 px-4">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-700">
            <XCircle size={17} aria-hidden className="text-red-500" />
            Payment didn&apos;t go through
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-500 ring-1 ring-slate-200">{visibleFailed.length}</span>
            <ChevronDown size={17} aria-hidden className="ml-auto text-ink-500 transition group-open:rotate-180" />
          </summary>
          <p className="pb-3 text-sm text-ink-500">
            These patients aren&apos;t in the queue: their M-Pesa check-in fee failed, or M-Pesa never told us the outcome
            (&ldquo;Check M-Pesa SMS&rdquo;). If the patient shows you an M-Pesa SMS for the fee, confirm it with the code to add
            them.
          </p>
          <ul className="grid gap-3 pb-4 xl:grid-cols-2">{visibleFailed.map(renderCard)}</ul>
        </details>
      )}
    </div>
  );
}

const ACCENT: Record<GroupKey, string> = {
  ATTENTION: 'before:bg-red-500',
  WAITING: 'before:bg-amber-500',
  IN_CONSULTATION: 'before:bg-teal-500',
  READY_FOR_CHECKOUT: 'before:bg-blue-500',
  DONE: 'before:bg-emerald-500',
};

function QueueCard({
  item,
  now,
  isFrontDesk,
  busy,
  emailDeliveryAvailable,
  delivery,
  onDelivery,
  onConfirmPayment,
  onCheckout,
  onChangeDoctor,
}: {
  item: QueueItem;
  now: number;
  isFrontDesk: boolean;
  busy: boolean;
  emailDeliveryAvailable: boolean;
  delivery: CheckoutDeliveryMethod;
  onDelivery: (value: CheckoutDeliveryMethod) => void;
  onConfirmPayment: () => void;
  onCheckout: () => void;
  onChangeDoctor: () => void;
}) {
  const status = displayStatus(item);
  const group = groupOf(item);
  const atCheckout = item.encounterStatus === 'READY_FOR_CHECKOUT' || item.encounterStatus === 'DONE';
  const stillWaiting = group === 'WAITING' || group === 'ATTENTION';
  const canChangeDoctor = isFrontDesk && group === 'WAITING' && item.encounterStatus === 'WAITING';

  return (
    <li
      className={`relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 pl-5 shadow-card transition before:absolute before:inset-y-0 before:left-0 before:w-1 hover:shadow-raised ${ACCENT[group]}`}
    >
      <div className="flex items-start gap-3">
        <Avatar name={item.patientName} />
        <Link to={`/patients/${item.patientId}`} className="group min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[16px] font-semibold text-navy-900 group-hover:underline">{item.patientName}</span>
            {item.source === 'WALK_IN' && (
              <span title={item.checkedInByName ? `Checked in at the front desk by ${item.checkedInByName}` : 'Checked in at the front desk'}>
                <WalkInBadge />
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-ink-500">
            {item.patientCode} · {item.departmentName} · {item.assignedDoctorName ?? 'Unassigned'}
          </p>
        </Link>
        {CHECK_IN_STATUS_LABEL[status] ? (
          <Badge tone="danger" icon={AlertTriangle}>
            {CHECK_IN_STATUS_LABEL[status]}
          </Badge>
        ) : (
          <StatusBadge status={status} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden />
          {stillWaiting ? (
            <>
              Waiting <span className="font-semibold text-navy-900">{waited(item.createdAt, now)}</span>
            </>
          ) : (
            <>Checked in {timeOf(item.createdAt)}</>
          )}
        </span>
        <span>{item.checkInStatus === 'NO_FEE' ? 'No fee' : `KES ${item.amountKes}`}</span>
        {canChangeDoctor && (
          <button
            type="button"
            onClick={onChangeDoctor}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1 text-[13px] font-semibold text-navy-900 transition hover:border-gold-500"
          >
            <Repeat2 size={14} aria-hidden /> Change doctor
          </button>
        )}
      </div>

      {(atCheckout || isUnresolvedPayment(item) || item.encounterStatus === 'READY_FOR_CHECKOUT') && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {atCheckout && (
            <>
              <StatusBadge status={item.billStatus ?? 'NONE'} />
              {item.billStatus !== 'PAID' && isFrontDesk && (
                <Link to={`/checkout/${item.encounterId}`} className="btn-gold min-h-9 px-4 py-1.5 text-[13px]">
                  {item.billStatus === 'PARTLY_PAID' ? `Collect KES ${item.billBalanceKes}` : 'Bill & pay'}
                  <ArrowRight size={14} aria-hidden />
                </Link>
              )}
              {item.billStatus === 'PAID' && (
                <Link to={`/checkout/${item.encounterId}`} className="text-[13px] font-medium text-navy-900 underline underline-offset-4">
                  Receipt
                </Link>
              )}
            </>
          )}
          {isUnresolvedPayment(item) && (
            <button
              onClick={onConfirmPayment}
              disabled={busy}
              className="min-h-9 rounded-full border border-slate-300 px-4 py-1.5 text-[13px] font-semibold text-navy-900 hover:border-gold-500 disabled:opacity-50"
            >
              Confirm payment
            </button>
          )}
          {item.encounterStatus === 'READY_FOR_CHECKOUT' && (
            <>
              {emailDeliveryAvailable && item.patientEmail && (
                <select
                  value={delivery}
                  onChange={(e) => onDelivery(e.target.value as CheckoutDeliveryMethod)}
                  disabled={busy}
                  aria-label="Visit summary delivery"
                  className="min-h-9 rounded-full border border-slate-300 bg-white px-3 py-1 text-[13px] text-navy-900"
                >
                  <option value="sms">SMS summary only</option>
                  <option value="sms_and_email">SMS + email PDF</option>
                </select>
              )}
              <button
                onClick={onCheckout}
                disabled={busy}
                className="min-h-9 rounded-full bg-navy-900 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-navy-700 disabled:opacity-50"
              >
                Checkout
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
