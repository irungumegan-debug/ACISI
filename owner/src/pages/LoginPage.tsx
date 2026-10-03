import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { ShieldCheck } from 'lucide-react';
import { LogoMark, Watermark } from '../components/ui';

export function LoginPage() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/overview';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const input =
    'min-h-12 w-full rounded-xl border border-white/15 bg-navy-950/50 px-3.5 py-3 text-base text-white placeholder:text-stone-500 focus:border-gold-400 focus:outline-none';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-900 px-4 py-12">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(38,52,95,0.9),transparent_70%)]" />
      <Watermark className="absolute left-1/2 top-1/2 w-[min(900px,160vw)] -translate-x-1/2 -translate-y-1/2 text-gold-400 opacity-[0.06]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <LogoMark size={42} />
          <span className="font-display text-2xl font-bold tracking-[0.14em] text-white">ACISI</span>
        </div>
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-navy-700/70 to-navy-850/90 p-7 shadow-2xl sm:p-8">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-gold-400/10 px-3 py-1 text-xs font-semibold text-gold-300">
            <ShieldCheck size={14} aria-hidden /> Owner
          </p>
          <h1 className="mb-1 font-display text-3xl font-bold tracking-tight text-white">Owner sign-in</h1>
          <p className="mb-6 text-[15px] text-stone-300">Platform owner sign-in. Every action here is recorded.</p>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-300" htmlFor="email">
                Email
              </label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-300" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-100">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-gold min-h-12 w-full px-4 py-3 text-base">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
