import bcrypt from 'bcrypt';

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    staff: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import {
  InvalidPinFormatError,
  StaffNotFoundError,
  comparePin,
  listClinicStaff,
  resetStaffPinByAdmin,
  resetStaffPinViaConsole,
  verifyStaffPin,
} from '../../src/services/staffService';

const mockRecordAudit = recordAuditEvent as jest.Mock;
const mockFindUnique = prisma.staff.findUnique as jest.Mock;
const mockFindFirst = prisma.staff.findFirst as jest.Mock;
const mockFindMany = prisma.staff.findMany as jest.Mock;
const mockUpdate = prisma.staff.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('comparePin', () => {
  it('returns true for the correct PIN and false for a wrong one, with no audit side effect', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const staff = { pinHash } as Parameters<typeof comparePin>[0];

    await expect(comparePin(staff, '1234')).resolves.toBe(true);
    await expect(comparePin(staff, '9999')).resolves.toBe(false);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe('verifyStaffPin (login — unchanged behavior after extracting comparePin)', () => {
  it('records STAFF_LOGIN_SUCCESS on a correct PIN', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const staff = { id: 'staff-1', pinHash } as Parameters<typeof verifyStaffPin>[0];

    await expect(verifyStaffPin(staff, '1234')).resolves.toBe(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_LOGIN_SUCCESS', actorId: 'staff-1', entityType: 'Staff' }),
    );
  });

  it('records STAFF_LOGIN_FAILED on a wrong PIN', async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const staff = { id: 'staff-1', pinHash } as Parameters<typeof verifyStaffPin>[0];

    await expect(verifyStaffPin(staff, 'wrong')).resolves.toBe(false);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_LOGIN_FAILED', actorId: 'staff-1', entityType: 'Staff' }),
    );
  });
});

describe('resetStaffPinViaConsole', () => {
  it('throws StaffNotFoundError for an unknown staff code, without touching anything', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(resetStaffPinViaConsole('ACI-STF-9999', '1234')).rejects.toThrow(StaffNotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('rejects a malformed PIN before touching the database', async () => {
    mockFindUnique.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K' });

    await expect(resetStaffPinViaConsole('ACI-STF-7F2K', '12')).rejects.toThrow(InvalidPinFormatError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('hashes and sets the new PIN, and records a console-specific SYSTEM audit event', async () => {
    mockFindUnique.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', name: 'Jane Wanjiru' });
    mockUpdate.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', name: 'Jane Wanjiru' });

    const result = await resetStaffPinViaConsole('aci-stf-7f2k', '654321');

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { staffCode: 'ACI-STF-7F2K' } });
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'staff-1' }, data: { pinHash: expect.any(String) } });
    const setHash = mockUpdate.mock.calls[0][0].data.pinHash;
    await expect(bcrypt.compare('654321', setHash)).resolves.toBe(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'SYSTEM', action: 'STAFF_PIN_RESET_VIA_CONSOLE', entityType: 'Staff', entityId: 'staff-1' }),
    );
    expect(result.name).toBe('Jane Wanjiru');
  });
});

describe('listClinicStaff', () => {
  it("scopes to the given clinic and maps each staff member's department name", async () => {
    mockFindMany.mockResolvedValue([
      { id: 's1', staffCode: 'ACI-STF-A', name: 'Dr. A', role: 'DOCTOR', isActive: true, department: { name: 'General' } },
      { id: 's2', staffCode: 'ACI-STF-B', name: 'B', role: 'RECEPTIONIST', isActive: true, department: null },
    ]);

    const result = await listClinicStaff('clinic-A');

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clinicId: 'clinic-A' } }));
    expect(result).toEqual([
      { id: 's1', staffCode: 'ACI-STF-A', name: 'Dr. A', role: 'DOCTOR', departmentName: 'General', isActive: true },
      { id: 's2', staffCode: 'ACI-STF-B', name: 'B', role: 'RECEPTIONIST', departmentName: null, isActive: true },
    ]);
  });
});

describe('resetStaffPinByAdmin', () => {
  it("throws StaffNotFoundError for a staff id that doesn't belong to the admin's own clinic — same as a bad id", async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(
      resetStaffPinByAdmin({ clinicId: 'clinic-A', staffId: 'staff-other-clinic', requestedByStaffId: 'admin-1' }),
    ).rejects.toThrow(StaffNotFoundError);

    expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: 'staff-other-clinic', clinicId: 'clinic-A' } });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('auto-generates a PIN when none is provided, hashes and sets it, and records who reset whose PIN', async () => {
    mockFindFirst.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', name: 'Jane Wanjiru', clinicId: 'clinic-A' });
    mockUpdate.mockResolvedValue({});

    const result = await resetStaffPinByAdmin({ clinicId: 'clinic-A', staffId: 'staff-1', requestedByStaffId: 'admin-1' });

    expect(result.newPin).toMatch(/^\d{6}$/);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'staff-1' }, data: { pinHash: expect.any(String) } });
    const setHash = mockUpdate.mock.calls[0][0].data.pinHash;
    await expect(bcrypt.compare(result.newPin, setHash)).resolves.toBe(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: 'admin-1',
        staffId: 'admin-1',
        action: 'STAFF_PIN_RESET',
        entityType: 'Staff',
        entityId: 'staff-1',
      }),
    );
  });

  it('uses an admin-supplied PIN instead of generating one, when given', async () => {
    mockFindFirst.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', name: 'Jane Wanjiru', clinicId: 'clinic-A' });
    mockUpdate.mockResolvedValue({});

    const result = await resetStaffPinByAdmin({ clinicId: 'clinic-A', staffId: 'staff-1', requestedByStaffId: 'admin-1', newPin: '135790' });

    expect(result.newPin).toBe('135790');
    const setHash = mockUpdate.mock.calls[0][0].data.pinHash;
    await expect(bcrypt.compare('135790', setHash)).resolves.toBe(true);
  });

  it('rejects a malformed admin-supplied PIN, without persisting anything', async () => {
    mockFindFirst.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', name: 'Jane Wanjiru', clinicId: 'clinic-A' });

    await expect(
      resetStaffPinByAdmin({ clinicId: 'clinic-A', staffId: 'staff-1', requestedByStaffId: 'admin-1', newPin: 'abc' }),
    ).rejects.toThrow(InvalidPinFormatError);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
