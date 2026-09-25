import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setUnauthorizedHandler, StaffSession } from '../lib/api';

interface AuthContextValue {
  session: StaffSession | null;
  loading: boolean;
  login: (staffCode: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(staffCode: string, pin: string): Promise<void> {
    await api.login(staffCode, pin);
    setSession(await api.me());
  }

  async function logout(): Promise<void> {
    await api.logout();
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
