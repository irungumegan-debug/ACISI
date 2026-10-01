import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">ACISI Staff Login</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with your staff ID and PIN.</p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="staffCode">
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          {lockedOut && (
            <p className="text-sm text-red-600">
              Too many wrong PINs, so login is paused for up to 15 minutes. Forgot your PIN?{' '}
              <a href="/login?reset=staff" className="font-medium underline">
                Reset it by SMS now
              </a>{' '}
              to get back in straight away.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {/* The reset form lives on the main site's login page (web/), shared
            with patients — a full navigation, since it's a different app. */}
        <p className="mt-4 text-center text-sm text-slate-500">
          Forgot your PIN?{' '}
          <a href="/login?reset=staff" className="font-medium text-slate-900 hover:underline">
            Reset it by SMS
          </a>
        </p>
      </div>
    </div>
  );
}
