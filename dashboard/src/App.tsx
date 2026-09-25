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
import { AppointmentsPage } from './pages/AppointmentsPage';
import { DoctorAppointmentsPage } from './pages/DoctorAppointmentsPage';

/** A doctor's home is their own queue; everyone else lands on the front-desk queue. */
function HomeRedirect() {
  const { session } = useAuth();
  const target = session?.role === 'DOCTOR' ? '/doctor/queue' : '/queue';
  return <Navigate to={target} replace />;
}

// Deliberately NOT `import.meta.env.PROD ? '/console' : '/'` — that was the
// actual bug. import.meta.env.BASE_URL is populated straight from
// vite.config.ts's `base` (itself resolved from Vite's `command` argument:
// 'build' vs 'serve' — never wrong). `import.meta.env.PROD`/`.MODE` go
// through a *separate* Vite mechanism that, we proved empirically, silently
// falls back to a development-mode build (unminified, PROD=false) when the
// host's build environment has NODE_ENV set to anything other than
// 'production' — which Railway's build container does, for the same reason
// its runtime container does (see src/app.ts's static-serving fix). That
// produced a real, deployed bundle with basename='/' baked in, which is why
// "/console/queue" matched no route: this file was the actual bug, not a
// stale build. BASE_URL always has a trailing slash ('/' or '/console/'),
// which React Router's basename prop doesn't want — hence the strip below.
const basename = import.meta.env.BASE_URL.length > 1 ? import.meta.env.BASE_URL.replace(/\/$/, '') : import.meta.env.BASE_URL;

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
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/doctor/queue" element={<DoctorQueuePage />} />
            <Route path="/doctor/appointments" element={<DoctorAppointmentsPage />} />
            <Route path="/doctor/encounters/:id" element={<DoctorEncounterPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
