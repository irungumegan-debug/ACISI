import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../lib/api';

interface PortalAuthContextValue {
  phoneNumber: string | null;
  loading: boolean;
  requestOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextValue | undefined>(undefined);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => setPhoneNumber(res.phoneNumberE164))
      .catch(() => setPhoneNumber(null))
      .finally(() => setLoading(false));
  }, []);

  async function requestOtp(phone: string): Promise<void> {
    await api.requestOtp(phone);
  }

  async function verifyOtp(phone: string, code: string): Promise<void> {
    const res = await api.verifyOtp(phone, code);
    setPhoneNumber(res.phoneNumberE164);
  }

  async function logout(): Promise<void> {
    await api.logout();
    setPhoneNumber(null);
  }

  return (
    <PortalAuthContext.Provider value={{ phoneNumber, loading, requestOtp, verifyOtp, logout }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}
