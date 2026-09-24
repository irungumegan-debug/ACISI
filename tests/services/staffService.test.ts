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
  StaffIsNotADoctorError,
  StaffNotFoundError,
  comparePin,
  getDoctorPresenceStatus,
  listClinicStaff,
  resetStaffPinByAdmin,
  resetStaffPinViaConsole,
  setDoctorPresenceByAdmin,
  setDoctorPresenceBySelf,
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

  it("marks a doctor's lastLoginAt (the 'in today' signal) on a correct PIN", async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const staff = { id: 'doc-1', pinHash, role: 'DOCTOR' } as Parameters<typeof verifyStaffPin>[0];

    await verifyStaffPin(staff, '1234');

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { lastLoginAt: expect.any(Date) } });
  });

  it("does not touch lastLoginAt for a non-doctor login, or for a doctor's wrong PIN", async () => {
    const pinHash = await bcrypt.hash('1234', 4);
    const receptionist = { id: 'staff-2', pinHash, role: 'RECEPTIONIST' } as Parameters<typeof verifyStaffPin>[0];
    const doctor = { id: 'doc-1', pinHash, role: 'DOCTOR' } as Parameters<typeof verifyStaffPin>[0];

    await verifyStaffPin(receptionist, '1234');
    await verifyStaffPin(doctor, 'wrong');

    expect(mockUpdate).not.toHaveBeenCalled();
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
  it("scopes to the given clinic and maps each staff member's department name and presence", async () => {
    const today = new Date();
    mockFindMany.mockResolvedValue([
      {
        id: 's1',
        staffCode: 'ACI-STF-A',
        name: 'Dr. A',
        role: 'DOCTOR',
        isActive: true,
        department: { name: 'General' },
        lastLoginAt: today,
        presenceOverride: null,
        presenceOverrideAt: null,
      },
      {
        id: 's2',
        staffCode: 'ACI-STF-B',
        name: 'B',
        role: 'RECEPTIONIST',
        isActive: true,
        department: null,
        lastLoginAt: null,
        presenceOverride: null,
        presenceOverrideAt: null,
      },
    ]);

    const result = await listClinicStaff('clinic-A');

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clinicId: 'clinic-A' } }));
    expect(result).toEqual([
      { id: 's1', staffCode: 'ACI-STF-A', name: 'Dr. A', role: 'DOCTOR', departmentName: 'General', isActive: true, presence: 'IN' },
      { id: 's2', staffCode: 'ACI-STF-B', name: 'B', role: 'RECEPTIONIST', departmentName: null, isActive: true, presence: null },
    ]);
  });
});

describe('getDoctorPresenceStatus', () => {
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  it('is NOT_IN_YET when neither field is set', () => {
    expect(getDoctorPresenceStatus({ lastLoginAt: null, presenceOverride: null, presenceOverrideAt: null })).toBe('NOT_IN_YET');
  });

  it('is IN after a login today', () => {
    expect(getDoctorPresenceStatus({ lastLoginAt: today, presenceOverride: null, presenceOverrideAt: null })).toBe('IN');
  });

  it("ignores a login from a previous day", () => {
    expect(getDoctorPresenceStatus({ lastLoginAt: yesterday, presenceOverride: null, presenceOverrideAt: null })).toBe('NOT_IN_YET');
  });

  it('an OUT override today beats an earlier login today', () => {
    const morning = new Date(today.getTime() - 60_000);
    expect(getDoctorPresenceStatus({ lastLoginAt: morning, presenceOverride: 'OUT', presenceOverrideAt: today })).toBe('OUT');
  });

  it('a fresh login after an OUT override today beats the override (showed up despite being marked out)', () => {
    const earlier = new Date(today.getTime() - 60_000);
    expect(getDoctorPresenceStatus({ lastLoginAt: today, presenceOverride: 'OUT', presenceOverrideAt: earlier })).toBe('IN');
  });

  it('an IN override with no login today still counts as in (e.g. admin marking them in on their behalf)', () => {
    expect(getDoctorPresenceStatus({ lastLoginAt: null, presenceOverride: 'IN', presenceOverrideAt: today })).toBe('IN');
  });

  it("ignores a stale override from a previous day", () => {
    expect(getDoctorPresenceStatus({ lastLoginAt: null, presenceOverride: 'OUT', presenceOverrideAt: yesterday })).toBe('NOT_IN_YET');
  });
});

describe('setDoctorPresenceBySelf', () => {
  it("sets the override and records a self-service audit event", async () => {
    const result = await setDoctorPresenceBySelf('doc-1', 'OUT');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { presenceOverride: 'OUT', presenceOverrideAt: expect.any(Date) },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: 'doc-1',
        staffId: 'doc-1',
        action: 'DOCTOR_PRESENCE_SET',
        entityType: 'Staff',
        entityId: 'doc-1',
        metadata: { status: 'OUT' },
      }),
    );
    expect(result).toEqual({ presence: 'OUT' });
  });
});

describe('setDoctorPresenceByAdmin', () => {
  it('returns 404-worthy StaffNotFoundError for a staff id outside the admin\'s clinic', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(
      setDoctorPresenceByAdmin({ clinicId: 'clinic-A', staffId: 'doc-1', requestedByStaffId: 'admin-1', status: 'OUT' }),
    ).rejects.toThrow(StaffNotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects setting presence on a non-doctor staff member', async () => {
    mockFindFirst.mockResolvedValue({ id: 'staff-2', clinicId: 'clinic-A', role: 'RECEPTIONIST', staffCode: 'ACI-STF-B', name: 'B' });

    await expect(
      setDoctorPresenceByAdmin({ clinicId: 'clinic-A', staffId: 'staff-2', requestedByStaffId: 'admin-1', status: 'OUT' }),
    ).rejects.toThrow(StaffIsNotADoctorError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sets the target doctor's override and records an admin-attributed audit event distinct from the self-service action", async () => {
    mockFindFirst.mockResolvedValue({ id: 'doc-1', clinicId: 'clinic-A', role: 'DOCTOR', staffCode: 'ACI-STF-A', name: 'Dr. A' });

    const result = await setDoctorPresenceByAdmin({
      clinicId: 'clinic-A',
      staffId: 'doc-1',
      requestedByStaffId: 'admin-1',
      status: 'IN',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { presenceOverride: 'IN', presenceOverrideAt: expect.any(Date) },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: 'admin-1',
        staffId: 'admin-1',
        action: 'DOCTOR_PRESENCE_SET_BY_ADMIN',
        entityType: 'Staff',
        entityId: 'doc-1',
        metadata: { targetStaffId: 'doc-1', targetStaffCode: 'ACI-STF-A', status: 'IN' },
      }),
    );
    expect(result).toEqual({ staffCode: 'ACI-STF-A', name: 'Dr. A', presence: 'IN' });
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
