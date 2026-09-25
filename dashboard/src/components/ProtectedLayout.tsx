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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="font-semibold text-slate-900">{session.clinicName}</p>
            <p className="text-sm text-slate-500">{session.staffName}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            {session.role === 'DOCTOR' ? (
              <>
                <Link to="/doctor/queue" className="text-slate-600 hover:text-slate-900">
                  My queue
                </Link>
                <Link to="/doctor/appointments" className="text-slate-600 hover:text-slate-900">
                  Appointments
                </Link>
              </>
            ) : (
              <>
                <Link to="/queue" className="text-slate-600 hover:text-slate-900">
                  Queue
                </Link>
                <Link to="/patients" className="text-slate-600 hover:text-slate-900">
                  Patients
                </Link>
                <Link to="/appointments" className="text-slate-600 hover:text-slate-900">
                  Appointments
                </Link>
                {session.role === 'ADMIN' && (
                  <Link to="/settings" className="text-slate-600 hover:text-slate-900">
                    Settings
                  </Link>
                )}
              </>
            )}
            <button onClick={() => void logout()} className="text-slate-600 hover:text-slate-900">
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
