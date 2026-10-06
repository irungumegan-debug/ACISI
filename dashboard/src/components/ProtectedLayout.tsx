import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, CalendarDays, ClipboardList, LogOut, Menu, ScrollText, Settings, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { legalBoxSatisfied, PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { Avatar, btn, LogoMark, Skeleton } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this item, so it stays highlighted (e.g. checkout under Queue). */
  also?: string[];
}

function navFor(role: string): NavItem[] {
  if (role === 'DOCTOR') {
    return [
      { to: '/doctor/queue', label: 'My queue', icon: ClipboardList, also: ['/doctor/encounters'] },
      { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
    ];
  }
  const items: NavItem[] = [
    { to: '/queue', label: 'Queue', icon: UsersRound, also: ['/walk-in', '/checkout'] },
    { to: '/patients', label: 'Patients', icon: UserRound },
    { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  ];
  if (role === 'ADMIN') {
    items.push({ to: '/reports/daily', label: 'Daily summary', icon: BarChart3 }, { to: '/settings', label: 'Settings', icon: Settings });
  }
  return items;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Clinic admin',
  RECEPTIONIST: 'Front desk',
  CLINICIAN: 'Clinician',
  DOCTOR: 'Doctor',
};

const PAGE_TITLES: [string, string][] = [
  ['/walk-in', 'Walk-in check-in'],
  ['/checkout', 'Checkout'],
  ['/reports/daily', 'Daily summary'],
  ['/patients', 'Patients'],
  ['/appointments', 'Appointments'],
  ['/settings', 'Settings'],
  ['/doctor/queue', 'My queue'],
  ['/doctor/appointments', 'Appointments'],
  ['/doctor/encounters', 'Consultation'],
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  const { pathname } = useLocation();
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

      <nav aria-label="Main" className="relative flex-1 space-y-1 px-3">
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
            </NavLink>
          );
        })}
      </nav>

      <div className="relative border-t border-white/10 p-3">
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
function AcceptTermsCard({ onAccepted }: { onAccepted: () => void }) {
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!legalBoxSatisfied(true, ticked)) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.acceptTerms();
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
        Please read and accept ACISI&apos;s Terms of Service to keep using the console. They set out what ACISI does, what your
        clinic is responsible for, and how patient data is handled.
      </p>
      <label className="mt-5 flex items-start gap-3 rounded-xl bg-cream-100 p-3.5 text-[15px] text-ink-700 ring-1 ring-slate-200">
        <input
          type="checkbox"
          required
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
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
  const staffId = session?.staffId;

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    setTermsStatus(null);
    api
      .getLegalStatus()
      .then((res) => !cancelled && setTermsStatus(res.termsAcceptanceRequired ? 'required' : 'accepted'))
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
            <Outlet />
          ) : termsStatus === 'required' ? (
            <AcceptTermsCard onAccepted={() => setTermsStatus('accepted')} />
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
