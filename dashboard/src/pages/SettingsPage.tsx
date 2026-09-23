import { useEffect, useState } from 'react';
import { api, ApiError, ClinicStaffListItem } from '../lib/api';

const PIN_PATTERN = /^\d{4,6}$/;

export function SettingsPage() {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const [staff, setStaff] = useState<ClinicStaffListItem[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ staffCode: string; name: string; newPin: string } | null>(null);

  useEffect(() => {
    api
      .getInviteCode()
      .then((res) => setInviteCode(res.inviteCode))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load invite code'));

    api
      .getClinicStaff()
      .then((res) => setStaff(res.staff))
      .catch((err) => setStaffError(err instanceof ApiError ? err.message : 'Failed to load staff'));
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

  async function handleResetPin(member: ClinicStaffListItem): Promise<void> {
    if (!confirm(`Reset the PIN for ${member.name} (${member.staffCode})? They'll need the new PIN to log in.`)) return;

    const typed = prompt('Enter a specific PIN (4-6 digits), or leave blank to generate one automatically:');
    if (typed === null) return; // cancelled
    const customPin = typed.trim();
    if (customPin && !PIN_PATTERN.test(customPin)) {
      setStaffError('PIN must be 4-6 digits');
      return;
    }

    setResettingId(member.id);
    setStaffError(null);
    try {
      const result = await api.resetStaffPin(member.id, customPin || undefined);
      setResetResult(result);
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : 'Failed to reset PIN');
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Clinic settings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Share this invite code with doctors and front-desk staff so they can create their own accounts.
      </p>

      <div className="mb-8 rounded-lg border border-slate-200 bg-white p-6">
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

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Staff & doctors</h2>
        <p className="mb-4 text-sm text-slate-500">Reset a staff or doctor&apos;s PIN if they&apos;ve forgotten it.</p>

        {resetResult && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              New PIN for <strong>{resetResult.name}</strong> ({resetResult.staffCode}):
            </p>
            <p className="my-1 font-mono text-2xl tracking-wide text-amber-900">{resetResult.newPin}</p>
            <p className="text-xs text-amber-800">Share this with them now — it won&apos;t be shown again.</p>
            <button
              onClick={() => setResetResult(null)}
              className="mt-2 text-xs font-medium text-amber-800 underline hover:text-amber-900"
            >
              Dismiss
            </button>
          </div>
        )}

        {staffError && <p className="mb-3 text-sm text-red-600">{staffError}</p>}

        {staff === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="text-sm text-slate-500">No staff registered yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {member.name}
                    {!member.isActive && <span className="ml-2 text-xs font-normal text-slate-400">(inactive)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {member.staffCode} · {member.role}
                    {member.departmentName ? ` · ${member.departmentName}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => void handleResetPin(member)}
                  disabled={resettingId === member.id}
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                >
                  {resettingId === member.id ? 'Resetting…' : 'Reset PIN'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
