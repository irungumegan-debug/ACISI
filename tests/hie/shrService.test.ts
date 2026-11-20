/** Shared Health Record per visit: consent, sending at checkout, reading, closing. */
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/hie/client', () => ({ ...jest.requireActual('../../src/hie/client'), hieConfigured: jest.fn(() => true) }));
jest.mock('../../src/hie/shr', () => ({
  READ_RESOURCES: [],
  listOpenVisits: jest.fn(async () => []),
  requestConsent: jest.fn(async () => ({ consentId: 'VCR-1', otpRecord: 'otp-rec-1', status: 'Pending', visitId: null, consentToken: null })),
  resendConsentOtp: jest.fn(async () => 'otp-rec-2'),
  decideConsent: jest.fn(async () => ({ consentToken: 'tok-1', visitId: 'visit-9', status: 'Approved', endDate: null })),
  refreshVisitToken: jest.fn(async () => 'tok-fresh'),
  closeVisit: jest.fn(async () => ({ otpRecord: 'close-rec', endDate: null })),
  submitBundle: jest.fn(async () => ({ mediatorId: 'b' })),
  fetchPatientRecords: jest.fn(async () => ({ entry: [{ resource: { resourceType: 'Condition', id: 'c', code: { text: 'Asthma' } } }] })),
}));
jest.mock('../../src/fhir/visitLoader', () => ({
  loadProblemRecords: jest.fn(async () => []),
  loadVisitRecords: jest.fn(async () => [
    {
      visit: { id: 'enc-1', status: 'DONE', createdAt: new Date(), checkedOutAt: new Date(), consultedAt: new Date(), visitReason: null, diagnosis: null, diagnosisCodes: [], prescription: null, prescriptionItems: [], clinicId: 'c1', departmentName: 'General', doctor: { id: 'doc-1', name: 'Dr A', staffCode: 'x' }, labOrders: [] },
      clinic: { id: 'c1', name: 'Sunrise', county: null },
    },
  ]),
}));

const state: { hieVisit: Record<string, unknown> | null; staffPuid: string | null } = { hieVisit: null, staffPuid: 'PUID-1' };
jest.mock('../../src/db/prisma', () => {
  const merge = (data: Record<string, unknown>) => {
    state.hieVisit = { ...(state.hieVisit ?? { id: 'hv-1', sendStatus: 'NOT_SENT', closeStatus: 'OPEN', emergency: false }), ...data };
    return state.hieVisit;
  };
  return {
    prisma: {
      encounter: {
        findFirst: jest.fn(async () => ({
          id: 'enc-1',
          patientId: 'p1',
          status: 'READY_FOR_CHECKOUT',
          patient: { idType: 'NATIONAL_ID', idNumber: '12345678', hieCrId: 'CR1-1', hieCrSourceHash: 'HASH', hieCrVerifiedAt: new Date() },
          clinic: { hieFacilityId: 'FID-1' },
          hieVisit: state.hieVisit,
          consultedByStaff: null,
          assignedDoctor: { id: 'doc-1', hiePractitionerId: 'PUID-1' },
        })),
      },
      staff: {
        findUnique: jest.fn(async () => ({ hiePractitionerId: state.staffPuid })),
        findMany: jest.fn(async () => [{ id: 'doc-1', name: 'Dr A', hiePractitionerId: 'PUID-1' }]),
      },
      patientAllergy: { findMany: jest.fn(async () => []) },
      hieVisit: {
        upsert: jest.fn(async ({ create, update }) => merge(state.hieVisit ? update : create)),
        update: jest.fn(async ({ data }) => merge(data)),
        findUnique: jest.fn(async () => state.hieVisit),
      },
    },
  };
});
jest.mock('../../src/hie/registryService', () => ({
  ...jest.requireActual('../../src/hie/registryService'),
  patientCrView: jest.fn(() => ({ crId: 'CR1-1', verifiedAt: new Date(), canLookUp: true })),
}));

import * as shr from '../../src/hie/shr';
import { recordAuditEvent } from '../../src/services/auditService';
import { HieError } from '../../src/hie/client';
import {
  confirmCloseCode,
  confirmConsentCode,
  queueVisitForShr,
  readNationalRecord,
  recordConsentRefusal,
  sendVisitToShr,
  startClose,
  startConsent,
} from '../../src/hie/shrService';

const base = { encounterId: 'enc-1', clinicId: 'c1', staffId: 's1' };
const actions = () => (recordAuditEvent as jest.Mock).mock.calls.map((c) => c[0].action);

beforeEach(() => {
  jest.clearAllMocks();
  state.hieVisit = null;
  state.staffPuid = 'PUID-1';
});

it('consent: DHA texts the patient; the code they read out opens the HIE visit', async () => {
  expect(await startConsent({ ...base, staffRole: 'RECEPTIONIST' })).toMatchObject({ consentStatus: 'PENDING' });
  expect(shr.requestConsent).toHaveBeenCalledWith({ crId: 'CR1-1', facilityId: 'FID-1', practitionerId: 'PUID-1', requestedBy: 'Registration Clerk' });
  expect(await confirmConsentCode({ ...base, code: '14384' })).toMatchObject({ consentStatus: 'APPROVED', canRead: true });
  expect(shr.decideConsent).toHaveBeenCalledWith({ consentId: 'VCR-1', facilityId: 'FID-1', otpRecord: 'otp-rec-1', otp: '14384' });
  expect(state.hieVisit).toMatchObject({ hieVisitId: 'visit-9', consentToken: 'tok-1' });
  expect(actions()).toEqual(['HIE_CONSENT_REQUESTED', 'HIE_CONSENT_APPROVED']);
});

it('a wrong code is reported plainly and logged', async () => {
  await startConsent({ ...base, staffRole: 'RECEPTIONIST' });
  (shr.decideConsent as jest.Mock).mockRejectedValueOnce(new HieError('invalid', 'x'));
  await expect(confirmConsentCode({ ...base, code: '11111' })).rejects.toThrow(/did not accept that code/);
  expect(actions()).toContain('HIE_CONSENT_CODE_WRONG');
});

it('a refusal is recorded with DHA and in ACISI; the reason is not kept in ACISI', async () => {
  await startConsent({ ...base, staffRole: 'RECEPTIONIST' });
  expect(await recordConsentRefusal({ ...base, reason: 'Patient declined' })).toMatchObject({ consentStatus: 'REJECTED' });
  expect(shr.decideConsent).toHaveBeenCalledWith({ consentId: 'VCR-1', facilityId: 'FID-1', reject: { reason: 'Patient declined' } });
  expect(JSON.stringify((recordAuditEvent as jest.Mock).mock.calls)).not.toContain('declined');
});

it('a visit still open at this clinic is reused (token refreshed), no new code', async () => {
  (shr.listOpenVisits as jest.Mock).mockResolvedValueOnce(['visit-open']);
  expect(await startConsent({ ...base, staffRole: 'RECEPTIONIST' })).toMatchObject({ consentStatus: 'APPROVED' });
  expect(shr.requestConsent).not.toHaveBeenCalled();
  expect(state.hieVisit).toMatchObject({ hieVisitId: 'visit-open', consentToken: 'tok-fresh' });
});

it('emergency consent: doctors only, approved at once', async () => {
  await expect(startConsent({ ...base, staffRole: 'RECEPTIONIST', emergencyReason: 'Unconscious' })).rejects.toThrow(/Only a doctor/);
  (shr.requestConsent as jest.Mock).mockResolvedValueOnce({ consentId: 'VCR-2', otpRecord: null, status: 'Approved', visitId: 'visit-e', consentToken: 'tok-e' });
  expect(await startConsent({ ...base, staffRole: 'DOCTOR', emergencyReason: 'Unconscious' })).toMatchObject({ consentStatus: 'APPROVED', emergency: true });
});

it('checkout queues the visit only when the patient consented', async () => {
  const enqueue = jest.fn();
  await queueVisitForShr('enc-1', enqueue);
  expect(enqueue).not.toHaveBeenCalled();
  state.hieVisit = { id: 'hv-1', consentStatus: 'PENDING', sendStatus: 'NOT_SENT' };
  await queueVisitForShr('enc-1', enqueue);
  expect(enqueue).not.toHaveBeenCalled();
  state.hieVisit = { id: 'hv-1', consentStatus: 'APPROVED', sendStatus: 'NOT_SENT' };
  await queueVisitForShr('enc-1', enqueue);
  expect(enqueue).toHaveBeenCalledWith('enc-1');
});

it('checkout is never blocked by the HIE', async () => {
  state.hieVisit = { id: 'hv-1', consentStatus: 'APPROVED', sendStatus: 'NOT_SENT' };
  await expect(queueVisitForShr('enc-1', jest.fn(async () => { throw new Error('redis down'); }))).resolves.toBeUndefined();
});

it('sending: the bundle goes to the SHR with the national ids; FAILED only after the last retry', async () => {
  state.hieVisit = { id: 'hv-1', clinicId: 'c1', patientId: 'p1', consentStatus: 'APPROVED', hieVisitId: 'visit-9', sendStatus: 'SENDING', closeStatus: 'OPEN' };
  (shr.submitBundle as jest.Mock).mockRejectedValueOnce(new HieError('unavailable', 'down'));
  await expect(sendVisitToShr('enc-1', 1, false)).rejects.toThrow();
  expect(state.hieVisit).toMatchObject({ sendStatus: 'SENDING' });
  await sendVisitToShr('enc-1', 2, false);
  const sent = (shr.submitBundle as jest.Mock).mock.calls[1][0];
  expect(sent.facilityId).toBe('FID-1');
  expect(JSON.stringify(sent.bundle)).toContain('Patient/CR1-1');
  expect(state.hieVisit).toMatchObject({ sendStatus: 'SENT' });
  // Same bundle id on the retry, so DHA can tell it's the same submission.
  expect(sent.bundle.id).toBe((shr.submitBundle as jest.Mock).mock.calls[0][0].bundle.id);
});

it('reading: needs the doctor’s PUID; refreshes an expired consent token once', async () => {
  state.hieVisit = { id: 'hv-1', consentStatus: 'APPROVED', hieVisitId: 'visit-9', consentToken: 'old' };
  state.staffPuid = null;
  await expect(readNationalRecord(base)).rejects.toThrow(/Verify your registration/);
  state.staffPuid = 'PUID-1';
  (shr.fetchPatientRecords as jest.Mock).mockRejectedValueOnce(new HieError('unauthorized', 'expired'));
  const items = await readNationalRecord(base);
  expect(items).toEqual([expect.objectContaining({ kind: 'Diagnosis', title: 'Asthma' })]);
  expect((shr.fetchPatientRecords as jest.Mock).mock.calls[1][0].consentToken).toBe('tok-fresh');
  expect(actions()).toContain('HIE_SHR_RECORDS_VIEWED');
});

it('closing: only after sending; DHA’s code confirms it and the token is dropped', async () => {
  state.hieVisit = { id: 'hv-1', consentId: 'VCR-1', consentStatus: 'APPROVED', hieVisitId: 'visit-9', consentToken: 'tok', sendStatus: 'SENDING', closeStatus: 'OPEN' };
  await expect(startClose(base)).rejects.toThrow(/Wait until/);
  state.hieVisit.sendStatus = 'SENT';
  expect(await startClose(base)).toMatchObject({ closeStatus: 'CODE_SENT' });
  expect(await confirmCloseCode({ ...base, code: '5555' })).toMatchObject({ closeStatus: 'CLOSED' });
  expect(shr.decideConsent).toHaveBeenCalledWith({ consentId: 'VCR-1', facilityId: 'FID-1', otpRecord: 'close-rec', otp: '5555' });
  expect(state.hieVisit).toMatchObject({ consentToken: null });
});
