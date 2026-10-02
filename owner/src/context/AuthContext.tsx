import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, OwnerSession } from '../lib/api';

interface AuthContextValue {
  session: OwnerSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Called when any request comes back 401 — the session expired or was revoked. */
  handleExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<void> {
    await api.login(email, password);
    setSession(await api.me());
  }

  async function logout(): Promise<void> {
    await api.logout();
    setSession(null);
  }

  function handleExpired(): void {
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, handleExpired }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
