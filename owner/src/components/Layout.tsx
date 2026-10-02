import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/overview', label: 'Overview' },
  { to: '/clinics', label: 'Clinics' },
  { to: '/activity', label: 'Activity log' },
  { to: '/delete-patient', label: 'Delete a patient' },
];

export function Layout() {
  const { session, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-stone-500">Loading…</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-800 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-semibold">ACISI</span>
            <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-900">
              Owner
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-stone-300 sm:inline">{session.name}</span>
            <button onClick={() => void logout()} className="text-stone-300 hover:text-white">
              Log out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 text-sm">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 ${
                  isActive ? 'border-amber-400 text-white' : 'border-transparent text-stone-400 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
