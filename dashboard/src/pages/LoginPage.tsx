import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { LogoMark, Watermark } from '../components/ui';

export function LoginPage() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/queue';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLockedOut(false);
    setSubmitting(true);
    try {
      await login(staffCode, pin);
      navigate('/queue', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setLockedOut(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-900 px-4 py-12">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(38,52,95,0.9),transparent_70%)]" />
      <Watermark className="absolute left-1/2 top-1/2 w-[min(900px,160vw)] -translate-x-1/2 -translate-y-1/2 text-gold-400 opacity-[0.06]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <LogoMark size={42} title="" />
          <span className="font-display text-2xl font-bold tracking-[0.14em] text-white">ACISI</span>
        </div>
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-navy-700/70 to-navy-850/90 p-7 shadow-2xl backdrop-blur sm:p-8">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-gold-400/10 px-3 py-1 text-xs font-semibold text-gold-300">
            <ShieldCheck size={14} aria-hidden /> Staff console
          </p>
          <h1 className="mb-1 font-display text-3xl font-bold tracking-tight text-white">Welcome back</h1>
          <p className="mb-6 text-[15px] text-slate-300">Sign in with your staff ID and PIN.</p>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="staffCode">
                Staff ID
              </label>
              <input
                id="staffCode"
                type="text"
                autoComplete="username"
                required
                value={staffCode}
                onChange={(e) => setStaffCode(e.target.value)}
                placeholder="ACI-STF-7F2K"
                className="min-h-12 w-full rounded-xl border border-white/15 bg-navy-950/50 px-3.5 py-3 text-base uppercase text-white placeholder:text-slate-500 focus:border-gold-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="pin">
                PIN
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-white/15 bg-navy-950/50 px-3.5 py-3 text-base text-white focus:border-gold-400 focus:outline-none"
              />
            </div>
            {lockedOut && (
              <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-100" role="alert">
                Too many wrong PINs, so login is paused for up to 15 minutes. Forgot your PIN?{' '}
                <a href="/login?reset=staff" className="font-semibold text-gold-300 underline">
                  Reset it by SMS now
                </a>{' '}
                to get back in straight away.
              </p>
            )}
            {error && (
              <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-100" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-gold min-h-12 w-full px-4 py-3 text-base">
              {submitting ? 'Signing in…' : 'Sign in'}
              {!submitting && <ArrowRight size={18} aria-hidden />}
            </button>
          </form>
          {/* The reset form lives on the main site's login page (web/), shared
              with patients — a full navigation, since it's a different app. */}
          <p className="mt-5 text-center text-sm text-slate-300">
            Forgot your PIN?{' '}
            <a href="/login?reset=staff" className="font-semibold text-gold-300 hover:underline">
              Reset it by SMS
            </a>
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-gold-400/80">Healthcare, within reach.</p>
      </div>
    </div>
  );
}
