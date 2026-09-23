import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedLayout } from './components/ProtectedLayout';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { DoctorQueuePage } from './pages/DoctorQueuePage';
import { DoctorEncounterPage } from './pages/DoctorEncounterPage';

/** A doctor's home is their own queue; everyone else lands on the front-desk queue. */
function HomeRedirect() {
  const { session } = useAuth();
  const target = session?.role === 'DOCTOR' ? '/doctor/queue' : '/queue';
  return <Navigate to={target} replace />;
}

// Matches vite.config.ts's base: only prefixed in production, where this
// app is served under /console rather than at the dev server's own root.
// (Cache-busting note: if you're staring at this after a "No routes matched
// /console/..." error in production, check whether the host actually
// rebuilt this file rather than assuming the logic below is wrong — see
// the basename value baked into the deployed bundle before touching this.)
const basename = import.meta.env.PROD ? '/console' : '/';

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<PatientDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/doctor/queue" element={<DoctorQueuePage />} />
            <Route path="/doctor/encounters/:id" element={<DoctorEncounterPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
