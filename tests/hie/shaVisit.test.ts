/** SHA claims: start visit (patient's SMS code, then SHA's virtual claim), through DHA's eClaims API. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/hie/shaAddon', () => ({ requireShaAddon: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/hie/client', () => ({ ...jest.requireActual('../../src/hie/client'), hieRequest: jest.fn(), hieConfigured: jest.fn(() => true) }));
jest.mock('../../src/hie/shaEligibility', () => ({ checkShaEligibility: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { encounter: { findFirst: jest.fn() }, shaVisit: { upsert: jest.fn(), update: jest.fn() } },
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { HieError, hieRequest } from '../../src/hie/client';
import { crSourceHash } from '../../src/hie/registryService';
import { checkShaEligibility } from '../../src/hie/shaEligibility';
import { claimDoctor, cleanServiceCodes, listShaContacts, sendShaVisitCode, startShaVisit } from '../../src/hie/shaVisit';

const CR = 'CR9795515286992-5';
const FR = 'FID-47-115307-8';
const NOW = new Date('2026-11-25T08:00:00Z');
const DOCTOR = { hieRegulator: 'KMPDC', hieRegistrationNumber: 'A12345', hieVerifiedAt: new Date('2026-11-20'), hieLicenceEnd: new Date('2027-12-31') };

function encounter(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    clinicId: 'c1',
    patientId: 'p1',
    status: 'WAITING',
    patient: { idType: 'NATIONAL_ID', idNumber: '12345678', hieCrId: CR, hieCrSourceHash: crSourceHash('NATIONAL_ID' as never, '12345678'), hieCrVerifiedAt: new Date() },
    clinic: { hieFacilityId: FR },
    shaVisit: null,
    assignedDoctor: null,
    consultedByStaff: null,
    ...over,
  };
}

const sent = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  encounterId: 'e1',
  status: 'CODE_SENT',
  interventionCodes: ['SHA-19-404'],
  codeSentAt: new Date(NOW.getTime() - 120_000),
  codeSendCount: 1,
  shaClaimId: null,
  shaVisitNumber: null,
  shaClaimStatus: null,
  shaWorkflowState: null,
  doctorAttached: false,
  startedAt: null,
  ...over,
});

const COVERED = { covered: true, deceased: false, consent: { biometricsEnforced: false, otpAllowed: true } };
const ids = { encounterId: 'e1', clinicId: 'c1', staffId: 's1' };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter());
  (checkShaEligibility as jest.Mock).mockResolvedValue(COVERED);
  (prisma.shaVisit.upsert as jest.Mock).mockImplementation(async ({ create }) => ({ ...sent(), ...create, codeSentAt: NOW }));
  (prisma.shaVisit.update as jest.Mock).mockImplementation(async ({ data }) => ({ ...sent(), ...data }));
});

describe('contacts', () => {
  it('lists the patient’s active contacts, masked as DHA sends them', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({
      results: [
        { id: 1, contactType: 'PHONE', contactValue: '+254714***898', active: true, isConfirmed: true },
        { id: 2, contactType: 'PHONE', contactValue: '+254700***111', active: false },
        { contactValue: 'no id' },
      ],
    });
    expect(await listShaContacts(ids)).toEqual([{ id: 1, type: 'PHONE', masked: '+254714***898', confirmed: true }]);
    expect(hieRequest).toHaveBeenCalledWith({ method: 'GET', path: '/patients/contacts', query: { patient_id: CR }, facilityId: FR });
  });
});

describe('sending the code', () => {
  it('checks cover, then asks SHA to text the code for the chosen services', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({ data: {}, message: 'ok' });
    const v = await sendShaVisitCode({ ...ids, interventionCodes: [' sha-19-404 ', 'SHA-19-404'], contactId: 1, now: NOW });
    expect(checkShaEligibility).toHaveBeenCalledWith({ patientId: 'p1', clinicId: 'c1', staffId: 's1' });
    expect(hieRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/claims/otp',
      body: { patient_id: CR, intervention_codes: ['SHA-19-404'], contact_id: 1 },
      facilityId: FR,
    });
    expect(v).toMatchObject({ status: 'CODE_SENT', interventionCodes: ['SHA-19-404'] });
    expect(v.canResendAt.getTime() - NOW.getTime()).toBe(60_000);
  });

  it('no contact chosen: DHA uses the patient’s default contact', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({});
    await sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'], now: NOW });
    expect((hieRequest as jest.Mock).mock.calls[0][0].body).toEqual({ patient_id: CR, intervention_codes: ['SHA-19-404'] });
  });

  it.each([
    ['not covered', { ...COVERED, covered: false }, /not covered/],
    ['deceased', { ...COVERED, covered: false, deceased: true }, /deceased/],
    ['fingerprint required', { ...COVERED, consent: { biometricsEnforced: true, otpAllowed: false } }, /fingerprint/],
  ])('%s: no code is sent', async (_, cover, msg) => {
    (checkShaEligibility as jest.Mock).mockResolvedValue(cover);
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'], now: NOW })).rejects.toThrow(msg);
    expect(hieRequest).not.toHaveBeenCalled();
  });

  it('a new code only after a minute, and at most 5 per visit', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent({ codeSentAt: new Date(NOW.getTime() - 20_000) }) }));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'], now: NOW })).rejects.toThrow(/Wait 40 seconds/);
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent({ codeSendCount: 5 }) }));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'], now: NOW })).rejects.toThrow(/Too many codes/);
    expect(hieRequest).not.toHaveBeenCalled();
  });

  it('refuses a finished visit, one already started, and a patient not yet in the Client Registry', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ status: 'DONE' }));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'] })).rejects.toThrow(/finished/);
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent({ status: 'STARTED' }) }));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'] })).rejects.toThrow(/already started/);
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ patient: { ...encounter().patient, hieCrId: null } }));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'] })).rejects.toThrow(/Client Registry/);
    expect(hieRequest).not.toHaveBeenCalled();
  });

  it('SHA rejecting the request gives a plain message and is audited', async () => {
    (hieRequest as jest.Mock).mockRejectedValue(new HieError('invalid', 'x', 400));
    await expect(sendShaVisitCode({ ...ids, interventionCodes: ['SHA-19-404'], now: NOW })).rejects.toThrow(/could not send a code/);
    expect((recordAuditEvent as jest.Mock).mock.calls.at(-1)[0]).toMatchObject({ action: 'SHA_VISIT_CODE_SENT', metadata: { error: 'invalid' } });
    expect(prisma.shaVisit.upsert).not.toHaveBeenCalled();
  });

  it('service codes: trimmed, upper-cased, de-duplicated, 1 to 10, no odd characters', () => {
    expect(cleanServiceCodes(['sha-19-404', 'SHA-19-404 '])).toEqual(['SHA-19-404']);
    expect(() => cleanServiceCodes([])).toThrow(/Choose/);
    expect(() => cleanServiceCodes(['../x'])).toThrow(/not valid/);
    expect(() => cleanServiceCodes(Array.from({ length: 11 }, (_, i) => `SHA-${i}`))).toThrow(/at most 10/);
  });
});

describe('starting the visit', () => {
  const CLAIM = { claim_id: 9876, visit_number: 'V-001', authorization_code: 'K5HLPJVDNV', claim_auth_status: 'AUTHORIZED', workflow_state: 'open' };

  it('sends the code with the services; stores the claim and the (encrypted) consent token, never shown', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent() }));
    (hieRequest as jest.Mock).mockResolvedValue(CLAIM);
    const v = await startShaVisit({ ...ids, code: '123456' });
    expect(hieRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/claims/visit',
      body: { patient_id: CR, service_type: 'OUTPATIENT', intervention_codes: ['SHA-19-404'], otp: '123456' },
      facilityId: FR,
    });
    expect((prisma.shaVisit.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ status: 'STARTED', shaClaimId: '9876', shaConsentToken: 'K5HLPJVDNV', doctorAttached: false });
    expect(v).toMatchObject({ status: 'STARTED', claimId: '9876', visitNumber: 'V-001', claimStatus: 'AUTHORIZED' });
    expect(JSON.stringify(v)).not.toContain('K5HLPJVDNV');
    const audit = JSON.stringify((recordAuditEvent as jest.Mock).mock.calls);
    expect(audit).not.toContain('123456');
    expect(audit).not.toContain('K5HLPJVDNV');
  });

  it('attaches the doctor only when DHA verified their registration and the licence is current', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent(), assignedDoctor: DOCTOR }));
    (hieRequest as jest.Mock).mockResolvedValue(CLAIM);
    await startShaVisit({ ...ids, code: '123456' });
    expect((hieRequest as jest.Mock).mock.calls[0][0].body).toMatchObject({
      practitioner_identification_type: 'registration_number',
      practitioner_identification_number: 'A12345',
      practitioner_regulation_body: 'KMPDC',
    });
    const now = new Date('2026-11-25');
    expect(claimDoctor({ assignedDoctor: { ...DOCTOR, hieVerifiedAt: null }, consultedByStaff: null } as never, now)).toBeNull();
    expect(claimDoctor({ assignedDoctor: { ...DOCTOR, hieLicenceEnd: new Date('2026-01-01') }, consultedByStaff: null } as never, now)).toBeNull();
    expect(claimDoctor({ assignedDoctor: { ...DOCTOR, hieRegulator: 'OTHER' }, consultedByStaff: null } as never, now)).toBeNull();
  });

  it('a wrong or expired code: plain message, nothing stored', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent() }));
    (hieRequest as jest.Mock).mockRejectedValue(new HieError('invalid', 'x', 400));
    await expect(startShaVisit({ ...ids, code: '000000' })).rejects.toThrow(/did not accept that code/);
    expect(prisma.shaVisit.update).not.toHaveBeenCalled();
  });

  it('no code sent yet, or a reply without claim or token: not started', async () => {
    await expect(startShaVisit({ ...ids, code: '123456' })).rejects.toThrow(/Send the patient an SHA code first/);
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(encounter({ shaVisit: sent() }));
    (hieRequest as jest.Mock).mockResolvedValue({ claim_id: 1 });
    await expect(startShaVisit({ ...ids, code: '123456' })).rejects.toThrow(/did not confirm/);
    expect(prisma.shaVisit.update).not.toHaveBeenCalled();
  });
});
