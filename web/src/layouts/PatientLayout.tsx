import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePatientAuth } from '../context/PatientAuthContext';

export function PatientLayout() {
  const { session, loading, logout } = usePatientAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="patient-portal" style={{ display: 'flex', minHeight: '100svh', alignItems: 'center', justifyContent: 'center' }}>
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
        <span className="brand">ACISI</span>
        <nav>
          <span className="who">
            {session.firstName} &middot; {session.patientCode}
          </span>
          <button onClick={() => void logout()}>Log out</button>
        </nav>
      </header>
      <main className="patient-main">
        <Outlet />
      </main>
    </div>
  );
}
