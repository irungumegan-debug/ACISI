import { useEffect, useState } from 'react';
import { api, ApiError, ClinicStaffListItem, DoctorPresenceStatus } from '../lib/api';
import { PaymentSettingsSection } from '../components/PaymentSettingsSection';
import { KeyRound, RefreshCw, UsersRound, Wallet } from 'lucide-react';
import { Avatar, Badge, Card, EmptyState, SkeletonList, Tone } from '../components/ui';

const PIN_PATTERN = /^\d{6}$/;

const PRESENCE_LABEL: Record<DoctorPresenceStatus, string> = {
  IN: 'In today',
  OUT: 'Out today',
  NOT_IN_YET: 'Not in today',
};

const PRESENCE_TONE: Record<DoctorPresenceStatus, Tone> = {
  IN: 'success',
  OUT: 'warning',
  NOT_IN_YET: 'neutral',
};

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Clinic admin', RECEPTIONIST: 'Front desk', CLINICIAN: 'Clinician', DOCTOR: 'Doctor' };
const smallBtn =
  'min-h-9 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-900 transition hover:border-gold-500 disabled:opacity-50';

export function SettingsPage() {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const [staff, setStaff] = useState<ClinicStaffListItem[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ staffCode: string; name: string; newPin: string } | null>(null);
  const [togglingPresenceId, setTogglingPresenceId] = useState<string | null>(null);

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

    const typed = prompt('Enter a specific 6-digit PIN, or leave blank to generate one automatically (recommended):');
    if (typed === null) return; // cancelled
    const customPin = typed.trim();
    if (customPin && !PIN_PATTERN.test(customPin)) {
      setStaffError('PIN must be exactly 6 digits');
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

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">Clinic settings</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Your clinic&apos;s invite code, how patients pay at checkout, and your team.</p>

      <div className="space-y-6">
        <Card title="Invite code" icon={KeyRound}>
          <p className="mb-4 text-sm text-ink-500">Share this invite code with doctors and front-desk staff so they can create their own accounts.</p>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-navy-900 px-5 py-4">
            <p className="font-mono text-2xl font-semibold tracking-[0.12em] text-gold-300">{inviteCode ?? '—'}</p>
            <button
              onClick={() => void handleRegenerate()}
              disabled={regenerating || !inviteCode}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-gold-400 hover:text-gold-300 disabled:opacity-50"
            >
              <RefreshCw size={15} aria-hidden /> {regenerating ? 'Regenerating…' : 'Regenerate invite code'}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </Card>

        <Card title="Payments" icon={Wallet}>
          <p className="mb-5 text-sm text-ink-500">How patients pay the clinic at checkout. The ACISI check-in fee is separate and unaffected.</p>
          <PaymentSettingsSection />
        </Card>

        <Card title="Staff & doctors" icon={UsersRound}>
          <p className="mb-4 text-sm text-ink-500">Reset a staff or doctor&apos;s PIN if they&apos;ve forgotten it.</p>

          {resetResult && (
            <div className="mb-4 rounded-2xl border border-gold-500/50 bg-gold-tint p-4" role="status">
              <p className="text-sm text-navy-900">
                New PIN for <strong>{resetResult.name}</strong> ({resetResult.staffCode}):
              </p>
              <p className="my-1 font-mono text-3xl font-semibold tracking-[0.2em] text-navy-900">{resetResult.newPin}</p>
              <p className="text-xs text-gold-700">Share this with them now — it won&apos;t be shown again.</p>
              <button onClick={() => setResetResult(null)} className="mt-2 text-xs font-semibold text-navy-900 underline">
                Dismiss
              </button>
            </div>
          )}

          {staffError && (
            <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {staffError}
            </p>
          )}

          {staff === null ? (
            <SkeletonList rows={3} label="Loading staff" />
          ) : staff.length === 0 ? (
            <EmptyState icon={UsersRound} title="No staff registered yet">
              Share the invite code above so your team can sign up.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {staff.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-cream-50">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy-900">
                        {member.name}
                        {!member.isActive && <span className="ml-2 text-xs font-normal text-slate-400">(inactive)</span>}
                      </p>
                      <p className="text-xs text-ink-500">
                        {member.staffCode} · {ROLE_LABEL[member.role] ?? member.role}
                        {member.departmentName ? ` · ${member.departmentName}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {member.presence && <Badge tone={PRESENCE_TONE[member.presence]}>{PRESENCE_LABEL[member.presence]}</Badge>}
                    {member.presence && (
                      <button onClick={() => void handleTogglePresence(member)} disabled={togglingPresenceId === member.id} className={smallBtn}>
                        {togglingPresenceId === member.id ? 'Updating…' : member.presence === 'IN' ? 'Mark out today' : 'Mark in today'}
                      </button>
                    )}
                    <button onClick={() => void handleResetPin(member)} disabled={resettingId === member.id} className={smallBtn}>
                      {resettingId === member.id ? 'Resetting…' : 'Reset PIN'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
