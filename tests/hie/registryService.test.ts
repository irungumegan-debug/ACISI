/** Client Registry lookups for patients: clear match saves, anything else waits for staff to compare. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/hie/registries', () => ({ ...jest.requireActual('../../src/hie/registries'), lookupClient: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { patient: { findFirst: jest.fn(), update: jest.fn() }, clinic: { findUnique: jest.fn() } },
}));

import { resetFakeRedis } from '../helpers/fakeRedis';
import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { lookupClient } from '../../src/hie/registries';
import { confirmPatientClientRegistryMatch, crSourceHash, lookUpPatientInClientRegistry, patientCrView } from '../../src/hie/registryService';

const PATIENT = { id: 'p1', firstName: 'Amina', lastName: 'Otieno', dateOfBirth: new Date('1990-04-02'), idType: 'NATIONAL_ID', idNumber: '12345678', hieCrId: null, hieCrSourceHash: null, hieCrVerifiedAt: null };
const CLIENT = { crId: 'CR9795515286992-5', firstName: 'Amina', middleName: null, lastName: 'Otieno', dateOfBirth: '1990-04-02', sex: 'FEMALE' };
const input = { patientId: 'p1', clinicId: 'c1', staffId: 's1' };

beforeEach(() => {
  resetFakeRedis();
  jest.clearAllMocks();
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT });
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ hieFacilityId: 'FID-47-115307-8' });
  (lookupClient as jest.Mock).mockResolvedValue({ ...CLIENT });
});

it('a clear match saves the CR ID, tied to the ID document it was found with', async () => {
  expect(await lookUpPatientInClientRegistry(input)).toEqual({ result: 'saved', crId: CLIENT.crId });
  expect(lookupClient).toHaveBeenCalledWith({ idType: 'NATIONAL_ID', idNumber: '12345678', facilityId: 'FID-47-115307-8' });
  expect(prisma.patient.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { hieCrId: CLIENT.crId, hieCrSourceHash: crSourceHash('NATIONAL_ID' as never, '12345678'), hieCrVerifiedAt: expect.any(Date) } });
  const audit = (recordAuditEvent as jest.Mock).mock.calls[0][0];
  expect(audit).toMatchObject({ action: 'HIE_CLIENT_REGISTRY_LOOKUP', metadata: { result: 'saved' } });
  expect(JSON.stringify(audit)).not.toContain('12345678');
});

it('a different name or date of birth is shown to staff, and saved only when they confirm', async () => {
  (lookupClient as jest.Mock).mockResolvedValue({ ...CLIENT, firstName: 'Grace' });
  const res = await lookUpPatientInClientRegistry(input);
  expect(res).toEqual({ result: 'check', registry: { firstName: 'Grace', middleName: null, lastName: 'Otieno', dateOfBirth: '1990-04-02', sex: 'FEMALE' } });
  expect(JSON.stringify(res)).not.toContain('CR979'); // the CR ID isn't handed out before confirmation
  expect(prisma.patient.update).not.toHaveBeenCalled();
  expect(await confirmPatientClientRegistryMatch(input)).toEqual({ crId: CLIENT.crId });
  expect(prisma.patient.update).toHaveBeenCalled();
});

it('another staff member cannot confirm someone else’s lookup', async () => {
  (lookupClient as jest.Mock).mockResolvedValue({ ...CLIENT, firstName: 'Grace' });
  await lookUpPatientInClientRegistry(input);
  await expect(confirmPatientClientRegistryMatch({ ...input, staffId: 's2' })).rejects.toThrow(/expired/);
});

it('needs the clinic facility code and an ID document first', async () => {
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ hieFacilityId: null });
  await expect(lookUpPatientInClientRegistry(input)).rejects.toThrow(/facility code/);
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT, idType: null, idNumber: null });
  await expect(lookUpPatientInClientRegistry(input)).rejects.toThrow(/ID document/);
});

it('a saved CR ID stops counting once the patient’s ID document changes', () => {
  const saved = { ...PATIENT, hieCrId: CLIENT.crId, hieCrSourceHash: crSourceHash('NATIONAL_ID' as never, '12345678'), hieCrVerifiedAt: new Date() } as never;
  expect(patientCrView(saved).crId).toBe(CLIENT.crId);
  expect(patientCrView({ ...(saved as object), idNumber: '87654321' } as never).crId).toBeNull();
});
