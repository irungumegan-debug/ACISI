import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PortalAuthProvider } from './context/PortalAuthContext';
import { Shell } from './components/Shell';
import { CheckInPage } from './pages/CheckInPage';
import { RecordsPage } from './pages/RecordsPage';

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <PortalAuthProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Navigate to="/checkin" replace />} />
            <Route path="/checkin" element={<CheckInPage />} />
            <Route path="/records" element={<RecordsPage />} />
          </Routes>
        </Shell>
      </PortalAuthProvider>
    </BrowserRouter>
  );
}
