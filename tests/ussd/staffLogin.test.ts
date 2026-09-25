import { UssdSessionContext } from '../../src/ussd/types';

jest.mock('../../src/services/staffService', () => ({
  findActiveStaffByCode: jest.fn(),
  findStaffByCode: jest.fn(),
  verifyStaffPin: jest.fn(),
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { findActiveStaffByCode, findStaffByCode, verifyStaffPin } from '../../src/services/staffService';
import { recordAuditEvent } from '../../src/services/auditService';
import { staffEnterCode, staffEnterPin } from '../../src/ussd/states/staffLogin';
import { MAX_STAFF_PIN_ATTEMPTS } from '../../src/config/constants';

const mockFindStaffRaw = findStaffByCode as jest.Mock;
const mockFindStaff = findActiveStaffByCode as jest.Mock;
const mockVerifyPin = verifyStaffPin as jest.Mock;
const mockRecordAudit = recordAuditEvent as jest.Mock;

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'STAFF_ENTER_CODE',
    phoneNumberE164: '+254712345678',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('staffEnterCode', () => {
  it('rejects an unrecognized staff code without ever asking for a PIN', async () => {
    mockFindStaffRaw.mockResolvedValue(null);
    const result = await staffEnterCode(freshSession(), 'ACI-STF-BOGUS');
    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('not recognized');
  });

  it('stashes the staff code and moves to PIN entry on a valid code', async () => {
    mockFindStaffRaw.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', isActive: true });
    const session = freshSession();
    const result = await staffEnterCode(session, 'aci-stf-7f2k');

    expect(result.nextState).toBe('STAFF_ENTER_PIN');
    expect(session.data.pendingStaffCode).toBe('ACI-STF-7F2K');
  });

  it('blocks a deactivated account with a clear message, never reaching PIN entry', async () => {
    mockFindStaffRaw.mockResolvedValue({ id: 'staff-1', staffCode: 'ACI-STF-7F2K', isActive: false });

    const result = await staffEnterCode(freshSession(), 'ACI-STF-7F2K');

    expect(result.continueSession).toBe(false);
    expect(result.response).toContain('deactivated');
    expect(result.nextState).toBeUndefined();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STAFF_LOGIN_BLOCKED_DEACTIVATED', actorId: 'staff-1', entityId: 'staff-1' }),
    );
  });
});

describe('staffEnterPin', () => {
  it('ends the session if no staff code was staged (session tampering / expiry)', async () => {
    const result = await staffEnterPin(freshSession(), '1234');
    expect(result.continueSession).toBe(false);
    expect(mockFindStaff).not.toHaveBeenCalled();
  });

  it('logs in on a correct PIN and clears pinAttempts', async () => {
    mockFindStaff.mockResolvedValue({ id: 'staff-1', clinicId: 'clinic-1' });
    mockVerifyPin.mockResolvedValue(true);

    const session: UssdSessionContext = { ...freshSession(), data: { pendingStaffCode: 'ACI-STF-7F2K' } };
    const result = await staffEnterPin(session, '1234');

    expect(result.nextState).toBe('STAFF_MENU');
    expect(session.data.staffId).toBe('staff-1');
    expect(session.data.clinicId).toBe('clinic-1');
  });

  it('ends the session after too many incorrect PIN attempts', async () => {
    mockFindStaff.mockResolvedValue({ id: 'staff-1', clinicId: 'clinic-1' });
    mockVerifyPin.mockResolvedValue(false);

    const session: UssdSessionContext = { ...freshSession(), data: { pendingStaffCode: 'ACI-STF-7F2K' } };
    let result;
    for (let i = 0; i < MAX_STAFF_PIN_ATTEMPTS; i++) {
      result = await staffEnterPin(session, 'wrong');
    }

    expect(result!.continueSession).toBe(false);
    expect(result!.response).toContain('Too many incorrect PIN attempts');
  });
});
