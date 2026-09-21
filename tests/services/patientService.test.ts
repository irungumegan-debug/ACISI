jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findMany: jest.fn() },
    consent: { findFirst: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { getScopedHistory } from '../../src/services/patientService';

const mockFindManyEncounters = prisma.encounter.findMany as jest.Mock;
const mockFindFirstConsent = prisma.consent.findFirst as jest.Mock;

function encounter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'enc-own',
    clinicId: 'clinic-A',
    createdAt: new Date('2026-01-01'),
    diagnosis: 'Flu',
    prescription: 'Paracetamol',
    clinic: { name: 'Sunrise Family Clinic' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getScopedHistory', () => {
  it('always shows the viewing clinic\'s own encounters, consent or not', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter()]);

    const result = await getScopedHistory('patient-1', 'clinic-A');

    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ isOwnClinic: true, diagnosis: 'Flu' });
    expect(result.hasHiddenHistoryElsewhere).toBe(false);
    expect(mockFindFirstConsent).not.toHaveBeenCalled(); // no other-clinic entries, so never even asks about consent
  });

  it('hides other-clinic encounters and flags them when the patient has not consented', async () => {
    mockFindManyEncounters.mockResolvedValue([
      encounter({ id: 'enc-other', clinicId: 'clinic-B', clinic: { name: 'Baraka Health Centre' } }),
    ]);
    mockFindFirstConsent.mockResolvedValue({ granted: false });

    const result = await getScopedHistory('patient-1', 'clinic-A');

    expect(result.history).toHaveLength(0);
    expect(result.hasHiddenHistoryElsewhere).toBe(true);
  });

  it('shows other-clinic encounters when the patient has consented', async () => {
    mockFindManyEncounters.mockResolvedValue([
      encounter({ id: 'enc-own', clinicId: 'clinic-A' }),
      encounter({ id: 'enc-other', clinicId: 'clinic-B', clinic: { name: 'Baraka Health Centre' } }),
    ]);
    mockFindFirstConsent.mockResolvedValue({ granted: true });

    const result = await getScopedHistory('patient-1', 'clinic-A');

    expect(result.history).toHaveLength(2);
    expect(result.hasHiddenHistoryElsewhere).toBe(false);
    expect(result.history.find((h) => h.encounterId === 'enc-other')).toMatchObject({ isOwnClinic: false });
  });

  it('excludes the encounter currently being viewed from the returned history', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter()]);

    await getScopedHistory('patient-1', 'clinic-A', 'enc-current');

    expect(mockFindManyEncounters).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'enc-current' } }) }),
    );
  });
});
