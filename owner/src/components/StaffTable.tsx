import { useState } from 'react';
import { api, ApiError, StaffListItem } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';
import { ActiveBadge, Button, TableWrap, td, th } from './ui';

/**
 * A clinic's doctors or staff, with deactivate/reactivate. Staff are never
 * erased — their names stay on the visits they handled — so "remove" here
 * means blocking their login and logging them out, which can be undone.
 */
export function StaffTable({ staff, kind, onChanged }: { staff: StaffListItem[]; kind: 'doctors' | 'staff'; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(s: StaffListItem): Promise<void> {
    const verb = s.isActive ? 'Deactivate' : 'Reactivate';
    const consequence = s.isActive
      ? 'They will be logged out immediately and will not be able to sign in or receive new patients.'
      : 'They will be able to sign in again.';
    if (!window.confirm(`${verb} ${s.name} (${s.staffCode})?\n\n${consequence}`)) return;

    setBusyId(s.id);
    setError(null);
    try {
      await api.setStaffActive(s.id, !s.isActive);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <TableWrap>
        <table className="min-w-full divide-y divide-stone-200">
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Staff ID</th>
              <th className={th}>{kind === 'doctors' ? 'Department' : 'Role'}</th>
              {kind === 'doctors' && <th className={`${th} text-right`}>Visits handled</th>}
              <th className={th}>Phone</th>
              <th className={th}>Last login</th>
              <th className={th}>Status</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {staff.map((s) => (
              <tr key={s.id}>
                <td className={`${td} font-medium text-stone-900`}>{s.name}</td>
                <td className={`${td} whitespace-nowrap font-mono text-xs`}>{s.staffCode}</td>
                <td className={td}>{kind === 'doctors' ? (s.departmentName ?? '—') : humanize(s.role)}</td>
                {kind === 'doctors' && <td className={`${td} text-right tabular-nums`}>{s.consultationCount}</td>}
                <td className={`${td} whitespace-nowrap tabular-nums`}>{s.phoneNumber}</td>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(s.lastLoginAt)}</td>
                <td className={td}>
                  <ActiveBadge isActive={s.isActive} />
                </td>
                <td className={`${td} text-right`}>
                  <Button onClick={() => void toggle(s)} disabled={busyId === s.id}>
                    {s.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
