import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, CalendarDays, FileBarChart, ClipboardList, FlaskConical, LogOut, Menu, Network, ScrollText, Settings, ShieldAlert, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError, LegalStatus } from '../lib/api';
import { CONFIDENTIALITY_UNDERTAKING_PATH, legalBoxSatisfied, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { Avatar, btn, LogoMark, Skeleton } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this item, so it stays highlighted (e.g. checkout under Queue). */
  also?: string[];
}

function navFor(role: string): NavItem[] {
  if (role === 'LAB_TECHNICIAN') {
    return [{ to: '/lab/queue', label: 'Lab queue', icon: FlaskConical, also: ['/lab/orders'] }];
  }
  if (role === 'DOCTOR') {
    return [
      { to: '/doctor/queue', label: 'My queue', icon: ClipboardList, also: ['/doctor/encounters'] },
      { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
      { to: '/surveillance', label: 'Disease surveillance', icon: ShieldAlert },
      { to: '/reports/routine', label: 'Routine reports', icon: FileBarChart },
      { to: '/national-hie', label: 'National HIE', icon: Network },
      { to: '/settings', label: 'Settings', icon: Settings },
    ];
  }
  const items: NavItem[] = [
    { to: '/queue', label: 'Queue', icon: UsersRound, also: ['/walk-in', '/checkout', '/visits'] },
    { to: '/patients', label: 'Patients', icon: UserRound },
    { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  ];
  if (role === 'ADMIN') {
    items.push(
      { to: '/reports/daily', label: 'Daily summary', icon: BarChart3 },
      { to: '/reports/routine', label: 'Routine reports', icon: FileBarChart },
      { to: '/surveillance', label: 'Disease surveillance', icon: ShieldAlert },
      { to: '/national-hie', label: 'National HIE', icon: Network },
      { to: '/settings', label: 'Settings', icon: Settings },
    );
  }
  if (role === 'CLINICIAN') items.push({ to: '/national-hie', label: 'National HIE', icon: Network });
  return items;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Clinic admin',
  RECEPTIONIST: 'Front desk',
  CLINICIAN: 'Clinician',
  DOCTOR: 'Doctor',
  LAB_TECHNICIAN: 'Lab technician',
};

const PAGE_TITLES: [string, string][] = [
  ['/walk-in', 'Walk-in check-in'],
  ['/checkout', 'Checkout'],
  ['/reports/daily', 'Daily summary'],
  ['/reports/routine', 'Routine reports'],
  ['/patients', 'Patients'],
  ['/appointments', 'Appointments'],
  ['/settings', 'Settings'],
  ['/national-hie', 'National HIE'],
  ['/visits', 'Vital signs'],
  ['/surveillance', 'Disease surveillance'],
  ['/doctor/queue', 'My queue'],
  ['/doctor/appointments', 'Appointments'],
  ['/doctor/encounters', 'Consultation'],
  ['/lab/queue', 'Lab queue'],
  ['/lab/orders', 'Lab request'],
  ['/queue', 'Queue'],
];

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const words = name.trim().split(/\s+/);
  const first = /^dr\.?$/i.test(words[0] ?? '') && words[1] ? `${words[0]} ${words[1]}` : (words[0] ?? '');
  return first ? `${part}, ${first}` : part;
}

function isActive(item: NavItem, pathname: string): boolean {
  return [item.to, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Immediately reportable cases not yet marked reported: doctors only, refreshed on every page change. */
function useUnreportedCount(role: string | undefined, pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (role !== 'DOCTOR' && role !== 'ADMIN') return;
    let cancelled = false;
    api
      .unreportedNotifiableCount()
      .then((r) => !cancelled && setCount(r.count))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [role, pathname]);
  return role === 'DOCTOR' || role === 'ADMIN' ? count : 0;
}

/**
 * On-screen alert on every page while an immediately reportable case or
 * public health event hasn't been reported to the Sub-County (doctors see
 * cases and events, clinic admins events). Works without SMS.
 */
function ReportNowBanner() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const count = useUnreportedCount(session?.role, pathname);
  if (count === 0 || pathname === '/surveillance') return null;
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 print:hidden">
      <p className="flex items-center gap-2 font-semibold">
        <ShieldAlert size={18} aria-hidden className="flex-none" />
        {count} immediately reportable {count === 1 ? 'case or event is' : 'cases or events are'} not yet reported to the Sub-County. Report within 24 hours.
      </p>
      <NavLink to="/surveillance" className="rounded-full bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-800">
        Open disease surveillance
      </NavLink>
    </div>
  );
}

/** Clinic admins: a reminder on every page while the clinic has fewer than 2 active admins. */
const MIN_CLINIC_ADMINS = 2;

function SecondAdminBanner() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const [activeAdmins, setActiveAdmins] = useState<number | null>(null);
  useEffect(() => {
    if (session?.role !== 'ADMIN') return;
    let cancelled = false;
    api
      .getClinicStaff()
      .then((r) => !cancelled && setActiveAdmins(r.staff.filter((s) => s.role === 'ADMIN' && s.isActive).length))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.role, pathname]);
  if (session?.role !== 'ADMIN' || activeAdmins === null || activeAdmins >= MIN_CLINIC_ADMINS) return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-400 bg-gold-tint px-4 py-3 text-sm text-navy-900 print:hidden">
      <p className="flex items-center gap-2 font-semibold">
        <ShieldAlert size={18} aria-hidden className="flex-none" />
        Add a second clinic admin. If you forget your PIN, only another admin at your clinic can reset it.
      </p>
      {pathname !== '/settings' && (
        <NavLink to="/settings" className="rounded-full bg-navy-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-800">
          Open Settings
        </NavLink>
      )}
    </div>
  );
}

/**
 * Admins and doctors: a reminder on every page (except Settings, where the
 * setup is) while multi-factor login is switched on and they haven't set up
 * their authenticator app yet.
 */
function MfaSetupBanner() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const [needsSetup, setNeedsSetup] = useState(false);
  const eligible = session?.role === 'ADMIN' || session?.role === 'DOCTOR';
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    api
      .getMfaStatus()
      .then((s) => !cancelled && setNeedsSetup(s.available && !s.setUp))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eligible, pathname]);
  if (!eligible || !needsSetup || pathname === '/settings') return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-400 bg-gold-tint px-4 py-3 text-sm text-navy-900 print:hidden">
      <p className="flex items-center gap-2 font-semibold">
        <ShieldAlert size={18} aria-hidden className="flex-none" />
        Protect your login: set up multi-factor login with an authenticator app (about 2 minutes).
      </p>
      <NavLink to="/settings" className="rounded-full bg-navy-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-800">
        Set it up in Settings
      </NavLink>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  const { pathname } = useLocation();
  const unreported = useUnreportedCount(session?.role, pathname);
  if (!session) return null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div aria-hidden className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-gold-400/10 blur-3xl" />
      <div className="relative flex items-center gap-3 px-5 pb-5 pt-6">
        <LogoMark size={34} title="" />
        <span className="font-display text-lg font-bold tracking-[0.14em] text-white">ACISI</span>
      </div>

      <div className="relative mx-4 mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <p className="truncate text-[13px] font-semibold uppercase tracking-wider text-gold-400">{session.clinicName}</p>
        <div className="mt-3 flex items-center gap-3">
          <Avatar name={session.staffName} className="ring-2 ring-gold-500/50" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{session.staffName}</p>
            <p className="truncate text-xs text-slate-300">{ROLE_LABEL[session.role] ?? session.role}</p>
          </div>
        </div>
      </div>

      <nav aria-label="Main" className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {navFor(session.role).map((item) => {
          const active = isActive(item, pathname);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${
                active ? 'bg-gold-400/10 text-gold-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {active && <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-foil" />}
              <item.icon size={19} aria-hidden className={active ? 'text-gold-400' : 'text-slate-400 group-hover:text-white'} />
              {item.label}
              {item.to === '/surveillance' && unreported > 0 && (
                <span className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${unreported} to report`}>
                  {unreported}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="relative flex-none border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => void logout()}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut size={19} aria-hidden className="text-slate-400" />
          Log out
        </button>
        <p className="px-3 pt-2 text-xs text-gold-400/80">Healthcare, within reach.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-xs">
          <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white hover:underline">
            Privacy Notice
          </a>
          <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white hover:underline">
            Terms of Service
          </a>
        </nav>
      </div>
    </div>
  );
}

/**
 * Shown instead of the page until the staff member has accepted the current
 * Terms of Service: once for accounts that existed before the Terms were
 * published, and again whenever the Terms are updated. A clinic admin who
 * accepted when registering the clinic is not asked again.
 */
function AcceptTermsCard({ onAccepted, legal }: { onAccepted: () => void; legal: LegalStatus | null }) {
  const termsRequired = legal?.termsRequired ?? true;
  const confidentialityRequired = legal?.confidentialityRequired ?? false;
  const [termsTicked, setTermsTicked] = useState(false);
  const [confidentialityTicked, setConfidentialityTicked] = useState(false);
  const ticked = (!termsRequired || termsTicked) && (!confidentialityRequired || confidentialityTicked);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!legalBoxSatisfied(true, ticked)) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.acceptTerms(confidentialityRequired && confidentialityTicked);
      onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mx-auto max-w-xl rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-gold-tint text-gold-700">
          <ScrollText size={22} aria-hidden />
        </span>
        <h1 className="font-display text-xl font-semibold text-navy-900">Before you continue</h1>
      </div>
      <p className="mt-4 text-[15px] text-ink-700">
        Please read and accept the following to keep using the console.
      </p>
      {confidentialityRequired && (
        <div className="mt-5 rounded-xl bg-cream-100 p-3.5 text-[15px] text-ink-700 ring-1 ring-slate-200">
          <p className="font-semibold text-navy-900">ACISI Confidentiality Undertaking</p>
          <p className="mt-2">
            Everyone with access to ACISI signs this undertaking.{' '}
            <a
              href={CONFIDENTIALITY_UNDERTAKING_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-navy-900 underline underline-offset-2"
            >
              Read the full undertaking
            </a>{' '}
            (opens in a new tab).
          </p>
          <label className="mt-3 flex items-start gap-3">
            <input
              type="checkbox"
              required
              checked={confidentialityTicked}
              onChange={(e) => setConfidentialityTicked(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
            />
            <span>
              I have read and agree to the{' '}
              <a href={CONFIDENTIALITY_UNDERTAKING_PATH} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                ACISI Confidentiality Undertaking
              </a>
              .
            </span>
          </label>
        </div>
      )}
      {termsRequired && (
      <label className="mt-5 flex items-start gap-3 rounded-xl bg-cream-100 p-3.5 text-[15px] text-ink-700 ring-1 ring-slate-200">
        <input
          type="checkbox"
          required
          checked={termsTicked}
          onChange={(e) => setTermsTicked(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-navy-900"
        />
        <span>
          I have read and accept the ACISI{' '}
          <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-700 underline">
            Terms of Service
          </a>
          . (See also the{' '}
          <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-700 underline">
            Privacy Notice
          </a>
          .)
        </span>
      </label>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={!ticked || submitting} className={`${btn.gold} mt-5 w-full sm:w-auto`}>
        {submitting ? 'Saving…' : 'Accept and continue'}
      </button>
    </form>
  );
}

export function ProtectedLayout() {
  const { session, loading } = useAuth();
  // null while checking; 'error' shows a retry rather than letting anyone past unchecked.
  const [termsStatus, setTermsStatus] = useState<'required' | 'accepted' | 'error' | null>(null);
  const [legal, setLegal] = useState<LegalStatus | null>(null);
  const staffId = session?.staffId;

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    setTermsStatus(null);
    api
      .getLegalStatus()
      .then((res) => {
        if (cancelled) return;
        setLegal(res);
        setTermsStatus(res.termsAcceptanceRequired ? 'required' : 'accepted');
      })
      .catch(() => !cancelled && setTermsStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [staffId]);
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="flex min-h-screen" role="status" aria-label="Loading">
        <div className="hidden w-64 flex-none bg-navy-900 lg:block" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 pt-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const title = PAGE_TITLES.find(([p]) => location.pathname === p || location.pathname.startsWith(`${p}/`))?.[1] ?? 'ACISI';
  const today = new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only z-50 rounded-lg bg-gold-400 px-4 py-2 font-semibold text-navy-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-none bg-gradient-to-b from-navy-900 to-navy-950 lg:block print:hidden">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile top bar + slide-in menu */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-navy-900 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-md lg:hidden print:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <LogoMark size={30} title="" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold tracking-[0.14em] text-white">ACISI</p>
            <p className="truncate text-xs text-gold-400">{session.clinicName}</p>
          </div>
        </div>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="console-menu"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/15 text-white"
        >
          <Menu size={22} aria-hidden />
        </button>
      </div>
      <div className={`fixed inset-0 z-40 lg:hidden print:hidden ${menuOpen ? '' : 'pointer-events-none'}`} aria-hidden={!menuOpen}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className={`absolute inset-0 bg-navy-950/60 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0'}`}
        />
        <div
          id="console-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-gradient-to-b from-navy-900 to-navy-950 shadow-2xl transition-transform duration-300 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {menuOpen && (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 hover:text-white"
              >
                <X size={22} aria-hidden />
              </button>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <header className="border-b border-slate-200/70 bg-cream-100/85 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-700">{title}</p>
              <p className="font-display text-lg font-semibold text-navy-900">{greeting(session.staffName)}</p>
            </div>
            <p className="text-sm text-ink-500">{today}</p>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {termsStatus === 'accepted' ? (
            <>
              <ReportNowBanner />
              <SecondAdminBanner />
              <MfaSetupBanner />
              <Outlet />
            </>
          ) : termsStatus === 'required' ? (
            <AcceptTermsCard legal={legal} onAccepted={() => setTermsStatus('accepted')} />
          ) : termsStatus === 'error' ? (
            <div className="mx-auto max-w-xl rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <p role="alert" className="text-sm text-red-700">
                Couldn&apos;t load the console. Check your connection and try again.
              </p>
              <button type="button" className={`${btn.secondary} mt-4`} onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          ) : (
            <div className="space-y-4" role="status" aria-label="Loading">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-64" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
