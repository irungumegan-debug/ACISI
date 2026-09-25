import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

export function SettingsPage() {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    api
      .getInviteCode()
      .then((res) => setInviteCode(res.inviteCode))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load invite code'));
  }, []);

  async function handleRegenerate(): Promise<void> {
    if (!confirm('Regenerate the invite code? The old code will stop working for new signups.')) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await api.regenerateInviteCode();
      setInviteCode(res.inviteCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to regenerate invite code');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Clinic settings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Share this invite code with doctors and front-desk staff so they can create their own accounts.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Invite code</p>
        <p className="mb-4 font-mono text-2xl text-slate-900">{inviteCode ?? '—'}</p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void handleRegenerate()}
          disabled={regenerating || !inviteCode}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : 'Regenerate invite code'}
        </button>
      </div>
    </div>
  );
}
