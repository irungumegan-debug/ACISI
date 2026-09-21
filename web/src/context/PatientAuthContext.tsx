import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, PatientSession } from '../lib/api';

interface PatientAuthContextValue {
  session: PatientSession | null;
  loading: boolean;
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

  async function logout(): Promise<void> {
    await api.patientLogout();
    setSession(null);
  }

  return <PatientAuthContext.Provider value={{ session, loading, logout }}>{children}</PatientAuthContext.Provider>;
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
