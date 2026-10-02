const mockStore = new Map<string, string>();

jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      mockStore.delete(key);
      return 1;
    }),
  },
}));

import { isSessionRevoked, revokeSessionsFor } from '../../src/services/sessionRevocation';
import { createDashboardSession, loadDashboardSession } from '../../src/dashboard/session';
import { createPatientSession, loadPatientSession } from '../../src/portal/session';

const STAFF_SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  clinicName: 'Sunrise',
  departmentId: null,
};

beforeEach(() => {
  mockStore.clear();
  jest.useRealTimers();
});

describe('isSessionRevoked', () => {
  it('is false when no marker exists for any subject', async () => {
    expect(await isSessionRevoked(['staff:x', 'clinic:y'], Date.now())).toBe(false);
  });

  it('revokes sessions issued at or before the marker, but not after', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    await revokeSessionsFor('staff:x');
    expect(await isSessionRevoked(['staff:x'], 999_999)).toBe(true);
    expect(await isSessionRevoked(['staff:x'], 1_000_000)).toBe(true);
    expect(await isSessionRevoked(['staff:x'], 1_000_001)).toBe(false);
  });

  it('treats a session with no issuedAt as revoked once any marker exists', async () => {
    await revokeSessionsFor('patient:p');
    expect(await isSessionRevoked(['patient:p'], undefined)).toBe(true);
  });
});

describe('session loaders honour revocation', () => {
  it('logs out a staff member when they are deactivated', async () => {
    jest.useFakeTimers({ now: 1_000 });
    const token = await createDashboardSession(STAFF_SESSION);
    expect(await loadDashboardSession(token)).toMatchObject({ staffId: 'staff-1' });

    jest.setSystemTime(2_000);
    await revokeSessionsFor('staff:staff-1');
    expect(await loadDashboardSession(token)).toBeNull();
  });

  it('logs out every staff member when their clinic is deactivated', async () => {
    jest.useFakeTimers({ now: 1_000 });
    const token = await createDashboardSession(STAFF_SESSION);
    jest.setSystemTime(2_000);
    await revokeSessionsFor('clinic:clinic-A');
    expect(await loadDashboardSession(token)).toBeNull();
  });

  it('lets a reactivated staff member log back in after the revocation', async () => {
    jest.useFakeTimers({ now: 1_000 });
    await revokeSessionsFor('staff:staff-1');
    jest.setSystemTime(2_000);
    const token = await createDashboardSession(STAFF_SESSION);
    expect(await loadDashboardSession(token)).toMatchObject({ staffId: 'staff-1' });
  });

  it("logs a deleted patient out on every device", async () => {
    jest.useFakeTimers({ now: 1_000 });
    const phone = await createPatientSession({ patientId: 'p-1', patientCode: 'ACI-AAAA', firstName: 'Jane' });
    const laptop = await createPatientSession({ patientId: 'p-1', patientCode: 'ACI-AAAA', firstName: 'Jane' });
    const other = await createPatientSession({ patientId: 'p-2', patientCode: 'ACI-BBBB', firstName: 'John' });
    jest.setSystemTime(2_000);
    await revokeSessionsFor('patient:p-1');
    expect(await loadPatientSession(phone)).toBeNull();
    expect(await loadPatientSession(laptop)).toBeNull();
    expect(await loadPatientSession(other)).toMatchObject({ patientId: 'p-2' });
  });
});
