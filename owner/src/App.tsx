import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ClinicsPage } from './pages/ClinicsPage';
import { ClinicDetailPage } from './pages/ClinicDetailPage';
import { DeletePatientPage } from './pages/DeletePatientPage';
import { ActivityPage } from './pages/ActivityPage';

// Derived from BASE_URL ('/' in dev, '/owner/' in a build), not
// import.meta.env.PROD — see the long note in dashboard/src/App.tsx for why.
const basename = import.meta.env.BASE_URL.length > 1 ? import.meta.env.BASE_URL.replace(/\/$/, '') : import.meta.env.BASE_URL;

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/clinics" element={<ClinicsPage />} />
            <Route path="/clinics/:id" element={<ClinicDetailPage />} />
            <Route path="/delete-patient" element={<DeletePatientPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
