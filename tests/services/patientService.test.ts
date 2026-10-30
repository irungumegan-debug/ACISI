jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findMany: jest.fn() },
    consent: { findFirst: jest.fn() },
    patient: { findFirst: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/recordSharingService', () => ({ crossClinicAccessBasis: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { findPatientByPhoneOrCode, getOwnVisitHistory, getScopedHistory } from '../../src/services/patientService';
import { crossClinicAccessBasis } from '../../src/services/recordSharingService';
import { recordAuditEvent } from '../../src/services/auditService';

const mockBasis = crossClinicAccessBasis as jest.Mock;

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

const DOCTOR = { includeDiagnosis: true };
const FRONT_DESK = { includeDiagnosis: false };

describe('getScopedHistory', () => {
  it('never returns a diagnosis to front desk (C2), but keeps the prescription and who handled the visit', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter({ consultedByStaff: { name: 'Dr. Amani' } })]);

    const result = await getScopedHistory('patient-1', 'clinic-A', FRONT_DESK);

    expect(result.history[0]).toMatchObject({ diagnosis: null, prescription: expect.any(String), doctorName: 'Dr. Amani' });
    expect(JSON.stringify(result)).not.toContain('Flu');
  });

  it('always shows the viewing clinic\'s own encounters, consent or not', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter()]);

    const result = await getScopedHistory('patient-1', 'clinic-A', DOCTOR);

    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ isOwnClinic: true, diagnosis: 'Flu' });
    expect(result.history[0]).toMatchObject({ isOwnClinic: true });
  });

  it('hides other-clinic encounters and flags them when the patient has not consented', async () => {
    mockFindManyEncounters.mockResolvedValue([
      encounter({ id: 'enc-other', clinicId: 'clinic-B', clinic: { name: 'Baraka Health Centre' } }),
    ]);
    mockBasis.mockResolvedValue(null);

    const result = await getScopedHistory('patient-1', 'clinic-A', DOCTOR);

    expect(result.history).toHaveLength(0);
    expect(result.hasHiddenHistoryElsewhere).toBe(true);
    expect(result.crossClinicBasis).toBeNull();
  });

  it('shows other-clinic encounters when the patient has consented', async () => {
    mockFindManyEncounters.mockResolvedValue([
      encounter({ id: 'enc-own', clinicId: 'clinic-A' }),
      encounter({ id: 'enc-other', clinicId: 'clinic-B', clinic: { name: 'Baraka Health Centre' } }),
    ]);
    mockBasis.mockResolvedValue('STANDING_CONSENT');

    const result = await getScopedHistory('patient-1', 'clinic-A', DOCTOR);

    expect(result.history).toHaveLength(2);
    expect(result.hasHiddenHistoryElsewhere).toBe(false);
    expect(result.history.find((h) => h.encounterId === 'enc-other')).toMatchObject({ isOwnClinic: false });
  });

  it('excludes the encounter currently being viewed from the returned history', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter()]);

    await getScopedHistory('patient-1', 'clinic-A', DOCTOR, 'enc-current');

    expect(mockFindManyEncounters).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'enc-current' } }) }),
    );
  });
});

describe('getOwnVisitHistory', () => {
  it("returns full diagnosis/prescription/department content, unfiltered by consent, for the patient's own encounters across every clinic", async () => {
    mockFindManyEncounters.mockResolvedValue([
      {
        id: 'enc-1',
        clinicId: 'clinic-A',
        createdAt: new Date('2026-01-01'),
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
        clinic: { name: 'Sunrise Family Clinic' },
        checkIn: { department: { name: 'General' } },
      },
    ]);

    const result = await getOwnVisitHistory('patient-1');

    expect(result).toEqual([
      {
        encounterId: 'enc-1',
        clinicName: 'Sunrise Family Clinic',
        departmentName: 'General',
        visitedAt: new Date('2026-01-01'),
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
      },
    ]);
    expect(mockFindFirstConsent).not.toHaveBeenCalled(); // this is the patient's own data — no consent gate applies
    expect(mockFindManyEncounters).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: 'patient-1' } }));
  });

  it('reports diagnosis/prescription as null when not yet recorded, rather than throwing', async () => {
    mockFindManyEncounters.mockResolvedValue([
      {
        id: 'enc-1',
        clinicId: 'clinic-A',
        createdAt: new Date('2026-01-01'),
        diagnosis: null,
        prescription: null,
        clinic: { name: 'Sunrise Family Clinic' },
        checkIn: { department: { name: 'General' } },
      },
    ]);

    const result = await getOwnVisitHistory('patient-1');

    expect(result[0]).toMatchObject({ diagnosis: null, prescription: null });
  });
});

describe('findPatientByPhoneOrCode', () => {
  const mockFindPatient = prisma.patient.findFirst as jest.Mock;

  it.each(['0711000111', '0711 000 111', '254711000111', '+254711000111', '+254 711 000 111'])(
    'finds the patient by phone typed as %s',
    async (typed) => {
      mockFindPatient.mockResolvedValue({ id: 'p-1' });
      await expect(findPatientByPhoneOrCode(typed)).resolves.toEqual({ id: 'p-1' });
      expect(mockFindPatient).toHaveBeenCalledWith({ where: { phoneNumber: '+254711000111', deletedAt: null } });
    },
  );

  it('looks patient IDs up by code, case-insensitively', async () => {
    mockFindPatient.mockResolvedValue({ id: 'p-1' });
    await findPatientByPhoneOrCode(' aci-dbub ');
    expect(mockFindPatient).toHaveBeenCalledWith({ where: { patientCode: 'ACI-DBUB', deletedAt: null } });
  });

  it('returns null for something that is neither a phone number nor a patient ID', async () => {
    await expect(findPatientByPhoneOrCode('hello')).resolves.toBeNull();
    expect(mockFindPatient).not.toHaveBeenCalled();
  });
});


describe('cross-clinic records are only shown with authorisation, and every view is logged (C4)', () => {
  const VIEWER = { includeDiagnosis: true, viewer: { staffId: 'staff-B', channel: 'DASHBOARD' } };
  const OTHER = { id: 'enc-other', clinicId: 'clinic-B', clinic: { name: 'Baraka Health Centre' } };

  it('no standing consent and no valid code: nothing from other clinics, even for a patient with history there', async () => {
    mockFindManyEncounters.mockResolvedValue([encounter(), encounter(OTHER)]);
    mockBasis.mockResolvedValue(null);
    const result = await getScopedHistory('patient-1', 'clinic-A', VIEWER);
    expect(result.history.map((h) => h.encounterId)).toEqual(['enc-own']);
    expect(JSON.stringify(result)).not.toContain('Baraka');
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('says "not authorised" the same way whether or not other-clinic records exist (no leak)', async () => {
    mockBasis.mockResolvedValue(null);
    mockFindManyEncounters.mockResolvedValue([encounter()]);
    const without = await getScopedHistory('patient-1', 'clinic-A', VIEWER);
    mockFindManyEncounters.mockResolvedValue([encounter(), encounter(OTHER)]);
    const withOther = await getScopedHistory('patient-1', 'clinic-A', VIEWER);
    expect(without.hasHiddenHistoryElsewhere).toBe(true);
    expect(withOther.hasHiddenHistoryElsewhere).toBe(true);
  });

  it.each(['STANDING_CONSENT', 'SHARING_CODE'])('access by %s is shown and audit-logged with clinic, staff and basis', async (basis) => {
    mockFindManyEncounters.mockResolvedValue([encounter(), encounter(OTHER)]);
    mockBasis.mockResolvedValue(basis);
    const result = await getScopedHistory('patient-1', 'clinic-A', VIEWER);
    expect(result.history).toHaveLength(2);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorType: 'STAFF',
      actorId: 'staff-B',
      staffId: 'staff-B',
      clinicId: 'clinic-A',
      action: 'CROSS_CLINIC_RECORDS_VIEWED',
      entityType: 'Patient',
      entityId: 'patient-1',
      metadata: { basis, encounterCount: 1, channel: 'DASHBOARD' },
    });
  });
});
