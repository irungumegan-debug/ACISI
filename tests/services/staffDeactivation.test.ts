jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn() }));

// A tiny in-memory staff table, so the "at least 2 admins" rule is tested on real rows.
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
  prisma: { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)), staff: mockTx.staff },
}));

import { recordAuditEvent } from '../../src/services/auditService';
import { revokeSessionsFor } from '../../src/services/sessionRevocation';
import { deactivateStaffByAdmin, makeStaffAdmin, StaffDeactivationError, StaffNotFoundError } from '../../src/services/staffService';

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

  it('refuses to take a clinic below 2 active admins', async () => {
    await expect(by('admin-1', 'admin-2')).rejects.toThrow(/at least 2 admins.*Make someone else an admin first/);
    expect(row('admin-2').isActive).toBe(true);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('can deactivate an admin while 2 other active admins remain', async () => {
    mockRows.push({ id: 'admin-3', clinicId: 'clinic-A', role: 'ADMIN', isActive: true, name: 'Admin Three' });
    await by('admin-1', 'admin-3');
    expect(row('admin-3').isActive).toBe(false);
    // ...and now, with 2 left, neither can be removed
    await expect(by('admin-1', 'admin-2')).rejects.toThrow(StaffDeactivationError);
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

describe('makeStaffAdmin (so a clinic can have its 2 admins)', () => {
  const make = (staffId: string) => makeStaffAdmin({ clinicId: 'clinic-A', staffId, requestedByStaffId: 'admin-1' });

  it('makes a front-desk member an admin, logs them out so the new role applies, and audit-logs it', async () => {
    await expect(make('rec-1')).resolves.toEqual({ id: 'rec-1', role: 'ADMIN' });
    expect(row('rec-1').role).toBe('ADMIN');
    expect(mockRevoke).toHaveBeenCalledWith('staff:rec-1');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_MADE_ADMIN', actorId: 'admin-1', entityId: 'rec-1', metadata: expect.objectContaining({ previousRole: 'RECEPTIONIST' }) }),
    );
  });

  it('refuses a doctor (one role per account: they would stop seeing patients)', async () => {
    await expect(make('doc-1')).rejects.toThrow(/doctor can't also be the clinic admin/);
    expect(row('doc-1').role).toBe('DOCTOR');
  });

  it('refuses a deactivated account, and another clinic\'s staff is "not found"', async () => {
    row('rec-1').isActive = false;
    await expect(make('rec-1')).rejects.toThrow(StaffDeactivationError);
    await expect(make('other-1')).rejects.toThrow(StaffNotFoundError);
  });

  it('is a no-op for someone already an admin', async () => {
    await expect(make('admin-2')).resolves.toEqual({ id: 'admin-2', role: 'ADMIN' });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
