import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, LoginCodeChallenge, StaffSession } from '../lib/api';
import { useIdleLogoff } from '../lib/useIdleLogoff';

interface AuthContextValue {
  session: StaffSession | null;
  loading: boolean;
  /** Returns a challenge when an SMS code is needed (admins and doctors); then call completeLogin. */
  login: (staffCode: string, pin: string) => Promise<LoginCodeChallenge | null>;
  completeLogin: (challengeId: string, code: string, rememberDevice: boolean) => Promise<void>;
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

  async function login(staffCode: string, pin: string): Promise<LoginCodeChallenge | null> {
    const result = await api.login(staffCode, pin);
    if ('mfaRequired' in result) return result;
    setSession(await api.me());
    return null;
  }

  async function completeLogin(challengeId: string, code: string, rememberDevice: boolean): Promise<void> {
    await api.verifyLoginCode(challengeId, code, rememberDevice);
    setSession(await api.me());
  }

  async function logout(): Promise<void> {
    await api.logout();
    setSession(null);
  }

  // Automatic logoff after 15 minutes without activity.
  useIdleLogoff(session !== null, api.pingActivity, () => {
    void api.logout().catch(() => undefined);
    setSession(null);
  });

  return <AuthContext.Provider value={{ session, loading, login, completeLogin, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
