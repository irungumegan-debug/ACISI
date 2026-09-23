import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, PatientSession } from '../lib/api';

interface PatientAuthContextValue {
  session: PatientSession | null;
  loading: boolean;
  login: (identifier: string, pin: string) => Promise<PatientSession>;
  /**
   * For callers (signup) that already have a PatientSession from their own
   * API call and just need the context to know about it — avoids a
   * redundant extra request to /patients/me.
   */
  setSession: (session: PatientSession) => void;
  logout: () => Promise<void>;
}

const PatientAuthContext = createContext<PatientAuthContextValue | undefined>(undefined);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .patientMe()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Login/signup happen inside this same SPA (unlike the staff/doctor
   * console, a separate bundle that needs a hard navigation to pick up a
   * fresh session) — so the fix for "successful login, but stuck on the
   * role picker" isn't a page reload, it's making sure this context's own
   * `session` state is updated *before* the page navigates client-side.
   * PatientLayout's guard reads this state, not a fresh fetch, so a
   * client-side navigate() right after login found `session` still null
   * from the one-time mount effect above and bounced straight back to
   * /login.
   */
  async function login(identifier: string, pin: string): Promise<PatientSession> {
    const result = await api.patientLogin(identifier, pin);
    setSession(result);
    return result;
  }

  async function logout(): Promise<void> {
    await api.patientLogout();
    setSession(null);
  }

  return (
    <PatientAuthContext.Provider value={{ session, loading, login, setSession, logout }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
