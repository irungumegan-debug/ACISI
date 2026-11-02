jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn() }));

// A tiny in-memory staff table, so the "last admin" rule is tested on real rows.
type Row = { id: string; clinicId: string; role: string; isActive: boolean; name: string };
let mockRows: Row[] = [];
const mockLocks: string[] = [];
const mockTx = {
  $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    mockLocks.push(String(values[0]));
    return 1;
  }),
  staff: {
    findFirst: jest.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
      mockRows.find((r) => r.id === where.id && r.clinicId === where.clinicId) ?? null,
    ),
    count: jest.fn(async ({ where }: { where: Partial<Row> }) =>
      mockRows.filter((r) => r.clinicId === where.clinicId && r.role === where.role && r.isActive === where.isActive).length,
    ),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = mockRows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  },
};
jest.mock('../../src/db/prisma', () => ({
  prisma: { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)) },
}));

import { recordAuditEvent } from '../../src/services/auditService';
import { revokeSessionsFor } from '../../src/services/sessionRevocation';
import { deactivateStaffByAdmin, StaffDeactivationError, StaffNotFoundError } from '../../src/services/staffService';

const mockAudit = recordAuditEvent as jest.Mock;
const mockRevoke = revokeSessionsFor as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockLocks.length = 0;
  mockRows = [
    { id: 'admin-1', clinicId: 'clinic-A', role: 'ADMIN', isActive: true, name: 'Admin One' },
    { id: 'admin-2', clinicId: 'clinic-A', role: 'ADMIN', isActive: true, name: 'Admin Two' },
    { id: 'doc-1', clinicId: 'clinic-A', role: 'DOCTOR', isActive: true, name: 'Dr Doc' },
    { id: 'rec-1', clinicId: 'clinic-A', role: 'RECEPTIONIST', isActive: true, name: 'Front Desk' },
    { id: 'other-1', clinicId: 'clinic-B', role: 'DOCTOR', isActive: true, name: 'Other Clinic' },
  ];
});

const by = (requestedByStaffId: string, staffId: string) => deactivateStaffByAdmin({ clinicId: 'clinic-A', staffId, requestedByStaffId });
const row = (id: string) => mockRows.find((r) => r.id === id)!;

describe('deactivateStaffByAdmin', () => {
  it('deactivates a staff member, keeps the row (records kept), logs them out and audit-logs it', async () => {
    await expect(by('admin-1', 'doc-1')).resolves.toEqual({ id: 'doc-1', isActive: false });

    expect(row('doc-1')).toMatchObject({ isActive: false, name: 'Dr Doc' }); // not erased
    expect(mockRows).toHaveLength(5);
    expect(mockRevoke).toHaveBeenCalledWith('staff:doc-1');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: 'admin-1',
        clinicId: 'clinic-A',
        action: 'STAFF_DEACTIVATED_BY_ADMIN',
        entityType: 'Staff',
        entityId: 'doc-1',
      }),
    );
  });

  it('refuses to deactivate yourself', async () => {
    await expect(by('admin-1', 'admin-1')).rejects.toThrow(StaffDeactivationError);
    expect(row('admin-1').isActive).toBe(true);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the clinic\'s last active admin', async () => {
    row('admin-2').isActive = false;
    // A second admin account (already inactive) tries via a stale screen; even
    // the check by another requester can't remove the only active admin.
    await expect(by('admin-2', 'admin-1')).rejects.toThrow("last admin");
    expect(row('admin-1').isActive).toBe(true);
  });

  it('can deactivate an admin while another active admin remains', async () => {
    await by('admin-1', 'admin-2');
    expect(row('admin-2').isActive).toBe(false);
    // ...and then admin-2 can no longer remove admin-1 (now the last one)
    await expect(by('admin-2', 'admin-1')).rejects.toThrow(StaffDeactivationError);
  });

  it('only within the admin\'s own clinic: another clinic\'s staff is "not found"', async () => {
    await expect(by('admin-1', 'other-1')).rejects.toThrow(StaffNotFoundError);
    expect(row('other-1').isActive).toBe(true);
  });

  it('runs the check under a per-clinic lock', async () => {
    await by('admin-1', 'rec-1');
    expect(mockLocks).toEqual(['clinic-admins:clinic-A']);
  });

  it('is a no-op for someone already deactivated (no second audit row)', async () => {
    row('rec-1').isActive = false;
    await expect(by('admin-1', 'rec-1')).resolves.toEqual({ id: 'rec-1', isActive: false });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
