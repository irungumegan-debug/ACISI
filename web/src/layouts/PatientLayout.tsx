import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { usePatientAuth } from '../context/PatientAuthContext';
import { LogoMark } from '../components/Logo';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function PatientLayout() {
  const { session, loading, logout } = usePatientAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="patient-portal patient-loading" role="status" aria-label="Loading">
        <LogoMark size={56} title="" />
        <p className="lede">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="patient-portal">
      <header className="patient-header">
        <div className="patient-header-inner">
          <div className="patient-brand">
            <LogoMark size={36} title="" />
            <span className="brand">ACISI</span>
          </div>
          <nav aria-label="Account">
            <button type="button" onClick={() => void logout()}>
              <LogOut size={16} aria-hidden /> Log out
            </button>
          </nav>
        </div>
        <div className="patient-hello">
          <p className="hello">
            {greeting()}, {session.firstName}
          </p>
          <p className="who">
            Patient ID <span className="who-code">{session.patientCode}</span>
          </p>
        </div>
      </header>
      <main className="patient-main">
        <Outlet />
      </main>
    </div>
  );
}
