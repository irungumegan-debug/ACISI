import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PatientAuthProvider } from './context/PatientAuthContext';
import { MarketingLayout, ContentLayout } from './layouts/MarketingLayout';
import { PatientLayout } from './layouts/PatientLayout';
import { RouteSeo } from './components/RouteSeo';
import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { PatientHomePage } from './pages/PatientHomePage';
import { LegalPage } from './pages/LegalPage';

export function App() {
  return (
    <BrowserRouter>
      <RouteSeo />
      <PatientAuthProvider>
        <Routes>
          <Route element={<MarketingLayout />}>
            <Route element={<ContentLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/privacy" element={<LegalPage document="privacy" />} />
              <Route path="/terms" element={<LegalPage document="terms" />} />
            </Route>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<PatientLayout />}>
            <Route path="/patient" element={<PatientHomePage />} />
          </Route>
        </Routes>
      </PatientAuthProvider>
    </BrowserRouter>
  );
}
