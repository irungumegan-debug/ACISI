import bcrypt from 'bcrypt';

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { recordAuditEvent } from '../../src/services/auditService';
import { comparePin, verifyStaffPin } from '../../src/services/staffService';

const mockRecordAudit = recordAuditEvent as jest.Mock;

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
