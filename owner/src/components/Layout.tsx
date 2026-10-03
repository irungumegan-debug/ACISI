import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Building2, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck, UserX, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LogoMark } from './ui';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/clinics', label: 'Clinics', icon: Building2 },
  { to: '/activity', label: 'Activity log', icon: ScrollText },
  { to: '/delete-patient', label: 'Delete a patient', icon: UserX },
];

function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? (w[w.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  if (!session) return null;
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div aria-hidden className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-gold-400/10 blur-3xl" />
      <div className="relative flex items-center gap-3 px-5 pb-5 pt-6">
        <LogoMark size={34} />
        <span className="font-display text-lg font-bold tracking-[0.14em] text-white">ACISI</span>
        <span className="rounded-full bg-foil px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-900">Owner</span>
      </div>
      <div className="relative mx-4 mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-navy-700 font-semibold text-gold-300 ring-2 ring-gold-500/50">
          {initials(session.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{session.name}</p>
          <p className="flex items-center gap-1 text-xs text-stone-300">
            <ShieldCheck size={12} aria-hidden className="text-gold-400" /> Platform owner
          </p>
        </div>
      </div>
      <nav aria-label="Main" className="relative flex-1 space-y-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${
                isActive ? 'bg-gold-400/10 text-gold-300' : 'text-stone-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute -left-3 bottom-2 top-2 w-1 rounded-r-full bg-foil" />}
                <item.icon size={19} aria-hidden className={isActive ? 'text-gold-400' : 'text-stone-400 group-hover:text-white'} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="relative border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => void logout()}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-stone-300 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut size={19} aria-hidden className="text-stone-400" /> Log out
        </button>
        <p className="px-3 pt-2 text-xs text-gold-400/80">Every action here is recorded.</p>
      </div>
    </div>
  );
}

export function Layout() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-900" role="status" aria-label="Loading">
        <LogoMark size={56} />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 flex-none bg-gradient-to-b from-navy-900 to-navy-950 lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-navy-900 px-4 py-3 shadow-md lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <span className="font-display text-sm font-bold tracking-[0.14em] text-white">ACISI</span>
          <span className="rounded-full bg-foil px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-900">Owner</span>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-white"
        >
          <Menu size={22} aria-hidden />
        </button>
      </div>
      <div className={`fixed inset-0 z-40 lg:hidden ${menuOpen ? '' : 'pointer-events-none'}`} aria-hidden={!menuOpen}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className={`absolute inset-0 bg-navy-950/60 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0'}`}
        />
        <div
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
                className="absolute right-3 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-xl text-stone-300 hover:text-white"
              >
                <X size={22} aria-hidden />
              </button>
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </>
          )}
        </div>
      </div>

      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
