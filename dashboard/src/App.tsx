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

export function App() {
  return (
    <BrowserRouter>
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
