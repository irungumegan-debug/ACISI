/** SHA claims phase 1: eligibility, benefits, sub-benefits and interventions, read through DHA's eClaims API. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/hie/client', () => ({ ...jest.requireActual('../../src/hie/client'), hieRequest: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { patient: { findFirst: jest.fn() }, clinic: { findUnique: jest.fn() } },
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { hieRequest } from '../../src/hie/client';
import { crSourceHash } from '../../src/hie/registryService';
import {
  checkShaEligibility,
  isPublicOfficerScheme,
  listShaBenefits,
  listShaInterventions,
  listShaSubBenefits,
  toEligibilityView,
  toInterventionView,
} from '../../src/hie/shaEligibility';

const CR = 'CR9795515286992-5';
const FR = 'FID-47-115307-8';
const PATIENT = {
  id: 'p1',
  idType: 'NATIONAL_ID',
  idNumber: '12345678',
  hieCrId: CR,
  hieCrSourceHash: crSourceHash('NATIONAL_ID' as never, '12345678'),
  hieCrVerifiedAt: new Date(),
};
const input = { patientId: 'p1', clinicId: 'c1', staffId: 's1' };
const ELIGIBLE = {
  fullName: 'Amina Otieno',
  memberCrNumber: CR,
  isAlive: true,
  whitelistedForOTP: false,
  facilityBiometricsEnforced: false,
  statusDesc: 'Success',
  schemes: [{ schemeName: 'UHC', memberType: 'PRINCIPAL', coverage: { status: 'ACTIVE', startDate: '2026-07-01', endDate: '2027-06-30' } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT });
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ hieFacilityId: FR });
});

describe('eligibility check', () => {
  it('asks DHA by the CR ID (DHA: use the CR ID by default), with the clinic facility code', async () => {
    (hieRequest as jest.Mock).mockResolvedValue(ELIGIBLE);
    const view = await checkShaEligibility(input);
    expect(hieRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/patients/eligibility',
      query: { identification_type: 'ClientRegistry ID', identification_number: CR },
      facilityId: FR,
    });
    expect(view).toMatchObject({
      covered: true,
      deceased: false,
      publicOfficerScheme: false,
      consent: { biometricsEnforced: false, otpAllowed: true },
      schemes: [{ name: 'UHC', coverageStatus: 'ACTIVE', active: true, validFrom: '2026-07-01', validTo: '2027-06-30' }],
    });
  });

  it('audits the outcome without the patient name, ID number or scheme details', async () => {
    (hieRequest as jest.Mock).mockResolvedValue(ELIGIBLE);
    await checkShaEligibility(input);
    const event = (recordAuditEvent as jest.Mock).mock.calls[0][0];
    expect(event).toMatchObject({ action: 'SHA_ELIGIBILITY_CHECKED', entityId: 'p1', metadata: { covered: true, deceased: false, schemes: 1 } });
    const json = JSON.stringify(event);
    expect(json).not.toContain('Amina');
    expect(json).not.toContain('12345678');
    expect(json).not.toContain('UHC');
  });

  it('lapsed cover is not covered, and DHA’s reason and fix are shown', () => {
    const v = toEligibilityView({
      isAlive: true,
      schemes: [{ schemeName: 'SHIF', coverage: { status: 'INACTIVE', reason: 'Contributions in arrears', possibleSolution: 'Pay outstanding contributions' } }],
    });
    expect(v.covered).toBe(false);
    expect(v.schemes[0]).toMatchObject({ active: false, reason: 'Contributions in arrears', possibleSolution: 'Pay outstanding contributions' });
  });

  it('a status word DHA has not documented counts as not covered (conservative until the sandbox confirms)', () => {
    expect(toEligibilityView({ isAlive: true, schemes: [{ schemeName: 'SHIF', coverage: { status: 'PENDING' } }] }).covered).toBe(false);
    expect(toEligibilityView({ isAlive: true, schemes: [] }).covered).toBe(false);
  });

  it('a deceased patient is never covered, whatever the schemes say', () => {
    const v = toEligibilityView({ ...ELIGIBLE, isAlive: false });
    expect(v).toMatchObject({ covered: false, deceased: true });
  });

  it('biometrics enforced: OTP only for whitelisted patients', () => {
    expect(toEligibilityView({ ...ELIGIBLE, facilityBiometricsEnforced: true, whitelistedForOTP: false }).consent).toEqual({ biometricsEnforced: true, otpAllowed: false });
    expect(toEligibilityView({ ...ELIGIBLE, facilityBiometricsEnforced: true, whitelistedForOTP: true }).consent).toEqual({ biometricsEnforced: true, otpAllowed: true });
  });

  it('POMSF is matched as a prefix (POMSF-047, POMSF-SHA), and TSC / USALAMA count too', () => {
    expect(['POMSF', 'POMSF-047', 'pomsf-sha', 'TSC', 'USALAMA'].every(isPublicOfficerScheme)).toBe(true);
    expect(['UHC', 'SHIF', 'POMSFX', 'NOTSC'].some(isPublicOfficerScheme)).toBe(false);
    expect(toEligibilityView({ ...ELIGIBLE, schemes: [{ schemeName: 'POMSF-047', coverage: { status: 'ACTIVE' } }] }).publicOfficerScheme).toBe(true);
  });

  it('needs the patient’s CR ID and the clinic facility code first, and asks DHA nothing until then', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT, hieCrId: null, hieCrSourceHash: null });
    await expect(checkShaEligibility(input)).rejects.toThrow(/Client Registry first/);
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT });
    (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ hieFacilityId: null });
    await expect(checkShaEligibility(input)).rejects.toThrow(/facility code/);
    expect(hieRequest).not.toHaveBeenCalled();
  });

  it('a CR ID saved for an old ID document is not used', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ ...PATIENT, idNumber: '99999999' });
    await expect(checkShaEligibility(input)).rejects.toThrow(/Client Registry first/);
  });

  it('a DHA failure is audited and passed on', async () => {
    const { HieError } = jest.requireActual('../../src/hie/client');
    (hieRequest as jest.Mock).mockRejectedValue(new HieError('unavailable', 'down'));
    await expect(checkShaEligibility(input)).rejects.toThrow('down');
    expect((recordAuditEvent as jest.Mock).mock.calls[0][0].metadata).toEqual({ error: 'unavailable' });
  });
});

describe('benefits, sub-benefits, interventions', () => {
  it('benefits: parent codes, without duplicates', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({
      results: [
        { parentBenefitCode: 'SHA-19', parentBenefit: 'Outpatient' },
        { parentBenefitCode: 'SHA-19', parentBenefit: 'Outpatient' },
        { parentBenefitCode: 'SHA-02', parentBenefit: 'Maternity' },
        { parentBenefit: 'no code' },
      ],
    });
    expect(await listShaBenefits(input)).toEqual([
      { code: 'SHA-19', name: 'Outpatient' },
      { code: 'SHA-02', name: 'Maternity' },
    ]);
    expect(hieRequest).toHaveBeenCalledWith({ method: 'GET', path: '/patients/benefits', query: { patient_id: CR }, facilityId: FR });
  });

  it('sub-benefits: outpatient and active only', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({
      results: [
        { code: 'SHA-19-SC-13', name: 'Consultation', accessPoint: 'OP' },
        { code: 'SHA-19-SC-20', name: 'Admission', accessPoint: 'IP' },
        { code: 'SHA-19-SC-21', name: 'Both', accessPoint: 'OP,IP' },
        { code: 'SHA-19-SC-22', name: 'Old', accessPoint: 'OP', active: false },
      ],
    });
    expect((await listShaSubBenefits({ ...input, benefitCode: 'SHA-19' })).map((s) => s.code)).toEqual(['SHA-19-SC-13', 'SHA-19-SC-21']);
  });

  it('rejects codes that are not codes, before calling DHA', async () => {
    await expect(listShaSubBenefits({ ...input, benefitCode: '../x' })).rejects.toThrow(/not valid/);
    await expect(listShaInterventions({ ...input, subBenefitCode: 'a b' })).rejects.toThrow(/not valid/);
    expect(hieRequest).not.toHaveBeenCalled();
  });

  it('interventions: outpatient filter, facility tariff, and what preauth needs, read off DHA’s record', async () => {
    (hieRequest as jest.Mock).mockResolvedValue({
      results: [
        { code: 'SHA-19-404', name: 'GP consultation', accessPoint: 'OP', paymentMechanism: 'FFS', kephLevelTarriff: 1200, overallTariff: 1500, needsPreauth: false },
        { code: 'SHA-19-501', name: 'CT scan', accessPoint: 'OP', overallTariff: 8000, needsPreauth: true, needsManualPreauthApproval: true, requiresRadiologyPreauth: true, applicableDocumentTypes: ['REQUEST_FORM', ''] },
        { code: 'SHA-19-900', name: 'Ward stay', accessPoint: 'IP' },
      ],
    });
    const out = await listShaInterventions({ ...input, subBenefitCode: 'SHA-19-SC-13', search: '  scan ' });
    expect(out).toEqual([
      { code: 'SHA-19-404', name: 'GP consultation', paymentMechanism: 'FFS', tariff: 1200, needsPreauth: false, preauthReviewedBySha: false, preauthForm: null, documents: [] },
      { code: 'SHA-19-501', name: 'CT scan', paymentMechanism: null, tariff: 8000, needsPreauth: true, preauthReviewedBySha: true, preauthForm: 'radiology', documents: ['REQUEST_FORM'] },
    ]);
    expect((hieRequest as jest.Mock).mock.calls[0][0].query).toEqual({ patient_id: CR, sub_benefit_code: 'SHA-19-SC-13', access_point: 'OP', search: 'scan', page_size: '50' });
  });

  it('an inactive or code-less intervention is dropped', () => {
    expect(toInterventionView({ code: 'X-1', active: false })).toBeNull();
    expect(toInterventionView({ name: 'no code' })).toBeNull();
  });
});
