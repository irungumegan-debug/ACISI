import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedLayout() {
  const { session, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const linkClass = (path: string) =>
    `rounded-md px-3 py-1.5 transition-colors ${
      location.pathname.startsWith(path) ? 'bg-gold-500 text-navy-900 font-semibold' : 'text-navy-100 hover:text-white'
    }`;

  return (
    <div className="min-h-screen">
      <header className="bg-navy-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="font-semibold text-white">{session.clinicName}</p>
            <p className="text-sm text-navy-200">{session.staffName}</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/queue" className={linkClass('/queue')}>
              Queue
            </Link>
            <Link to="/patients" className={linkClass('/patients')}>
              Patients
            </Link>
            <button onClick={() => void logout()} className="rounded-md px-3 py-1.5 text-navy-100 hover:text-white">
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
