import { useEffect, useState } from 'react';
import { api, AccountStatus, ApiError, ClinicStaffListItem, DoctorPresenceStatus } from '../lib/api';

const PIN_PATTERN = /^\d{4,6}$/;

const PRESENCE_LABEL: Record<DoctorPresenceStatus, string> = {
  IN: 'In today',
  OUT: 'Out today',
  NOT_IN_YET: 'Not in today',
};

const PRESENCE_BADGE_CLASS: Record<DoctorPresenceStatus, string> = {
  IN: 'bg-emerald-100 text-emerald-800',
  OUT: 'bg-amber-100 text-amber-800',
  NOT_IN_YET: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  DEACTIVATED: 'Deactivated',
};

const STATUS_BADGE_CLASS: Record<AccountStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  DEACTIVATED: 'bg-slate-200 text-slate-600',
};

export function TeamPage() {
  const [staff, setStaff] = useState<ClinicStaffListItem[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ staffCode: string; name: string; newPin: string } | null>(null);
  const [togglingPresenceId, setTogglingPresenceId] = useState<string | null>(null);
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null);

  function refresh(): void {
    api
      .getClinicStaff()
      .then((res) => setStaff(res.staff))
      .catch((err) => setStaffError(err instanceof ApiError ? err.message : 'Failed to load staff'));
  }

  useEffect(refresh, []);

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

  async function handleTogglePresence(member: ClinicStaffListItem): Promise<void> {
    const nextStatus = member.presence === 'IN' ? 'OUT' : 'IN';
    setTogglingPresenceId(member.id);
    setStaffError(null);
    try {
      const result = await api.setStaffPresence(member.id, nextStatus);
      setStaff((prev) => prev && prev.map((s) => (s.id === member.id ? { ...s, presence: result.presence } : s)));
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : 'Failed to update presence');
    } finally {
      setTogglingPresenceId(null);
    }
  }

  async function handleDeactivate(member: ClinicStaffListItem): Promise<void> {
    if (
      !confirm(
        `Deactivate ${member.name} (${member.staffCode})? They will not be able to log in until reactivated. Their past records are kept exactly as they are.`,
      )
    ) {
      return;
    }

    setTogglingStatusId(member.id);
    setStaffError(null);
    try {
      const result = await api.deactivateStaff(member.id);
      setStaff((prev) => prev && prev.map((s) => (s.id === member.id ? { ...s, status: result.status, isActive: result.status === 'ACTIVE' } : s)));
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : 'Failed to deactivate account');
    } finally {
      setTogglingStatusId(null);
    }
  }

  async function handleReactivate(member: ClinicStaffListItem): Promise<void> {
    if (!confirm(`Reactivate ${member.name} (${member.staffCode})? They will be able to log in again immediately.`)) return;

    setTogglingStatusId(member.id);
    setStaffError(null);
    try {
      const result = await api.reactivateStaff(member.id);
      setStaff((prev) => prev && prev.map((s) => (s.id === member.id ? { ...s, status: result.status, isActive: result.status === 'ACTIVE' } : s)));
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : 'Failed to reactivate account');
    } finally {
      setTogglingStatusId(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Team</h1>
      <p className="mb-6 text-sm text-slate-500">Everyone at your clinic — reset a PIN, or deactivate an account that should no longer have access.</p>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
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
                  <p className="truncate font-medium text-slate-900">{member.name}</p>
                  <p className="text-xs text-slate-500">
                    {member.staffCode} · {member.role}
                    {member.departmentName ? ` · ${member.departmentName}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[member.status]}`}>
                    {STATUS_LABEL[member.status]}
                  </span>
                  {member.presence && (
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PRESENCE_BADGE_CLASS[member.presence]}`}>
                      {PRESENCE_LABEL[member.presence]}
                    </span>
                  )}
                  {member.presence && (
                    <button
                      onClick={() => void handleTogglePresence(member)}
                      disabled={togglingPresenceId === member.id || member.status === 'DEACTIVATED'}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                    >
                      {togglingPresenceId === member.id ? 'Updating…' : member.presence === 'IN' ? 'Mark out today' : 'Mark in today'}
                    </button>
                  )}
                  <button
                    onClick={() => void handleResetPin(member)}
                    disabled={resettingId === member.id || member.status === 'DEACTIVATED'}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
                  >
                    {resettingId === member.id ? 'Resetting…' : 'Reset PIN'}
                  </button>
                  {member.status === 'ACTIVE' ? (
                    <button
                      onClick={() => void handleDeactivate(member)}
                      disabled={togglingStatusId === member.id}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:border-red-500 disabled:opacity-50"
                    >
                      {togglingStatusId === member.id ? 'Deactivating…' : 'Deactivate'}
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleReactivate(member)}
                      disabled={togglingStatusId === member.id}
                      className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:border-emerald-500 disabled:opacity-50"
                    >
                      {togglingStatusId === member.id ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
