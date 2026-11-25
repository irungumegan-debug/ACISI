import { Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest, isFrontDeskRole, requireAdmin, requireStaffSession } from './auth';
import { HieError, hieConfigured, hieErrorStatus } from '../hie/client';
import { FACILITY_IDENTIFIER_TYPES, HIE_REGULATORS, FacilityIdentifierType } from '../hie/registries';
import {
  confirmPatientClientRegistryMatch,
  findFacilities,
  HieSetupError,
  lookUpPatientInClientRegistry,
  practitionerView,
  PRACTITIONER_ROLES,
  setClinicFacility,
  verifyOwnPractitionerRecord,
} from '../hie/registryService';
import {
  confirmCloseCode,
  confirmConsentCode,
  getHieVisit,
  readNationalRecord,
  recordConsentRefusal,
  resendConsentCode,
  retrySend,
  startClose,
  startConsent,
} from '../hie/shrService';
import { enqueueHieShrSend } from '../jobs/queue';
import { checkShaEligibility, listShaBenefits, listShaInterventions, listShaSubBenefits } from '../hie/shaEligibility';
import { assertEncounterInDoctorQueue } from '../services/encounterService';
import { getDoctorDepartmentIds } from '../services/departmentService';

/**
 * National Health Information Exchange (DHA HIE): registries. Everything
 * answers 503 "not connected yet" until HIE_ENABLED=true with DHA's
 * credentials (see src/hie/client.ts).
 */
export const hieRouter = Router();
hieRouter.use(requireStaffSession);

const session = (req: unknown) => (req as AuthenticatedRequest).dashboardSession;

function sendHieError(res: Response, err: unknown): void {
  if (err instanceof HieError) {
    res.status(hieErrorStatus(err)).json({ error: err.message, hie: err.kind });
    return;
  }
  if (err instanceof HieSetupError) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

/** What the settings pages show: connected?, this clinic's facility, and the caller's own practitioner record. */
hieRouter.get('/status', async (req, res) => {
  const { clinicId, staffId, role } = session(req);
  const [clinic, me] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { hieFacilityId: true, hieFacilityName: true, hieFacilityVerifiedAt: true } }),
    prisma.staff.findUnique({ where: { id: staffId } }),
  ]);
  res.json({
    connected: hieConfigured(),
    facility: clinic?.hieFacilityId ? { frCode: clinic.hieFacilityId, name: clinic.hieFacilityName, verifiedAt: clinic.hieFacilityVerifiedAt } : null,
    practitioner: PRACTITIONER_ROLES.includes(role) && me ? practitionerView(me) : null,
  });
});

const facilitySearchSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  identifier: z.string().trim().min(2).max(40).optional(),
  identifierType: z.enum(FACILITY_IDENTIFIER_TYPES as [FacilityIdentifierType, ...FacilityIdentifierType[]]).optional(),
});

hieRouter.get('/facilities', requireAdmin, async (req, res) => {
  const parsed = facilitySearchSchema.safeParse(req.query);
  if (!parsed.success || (!parsed.data.name && !parsed.data.identifier)) {
    res.status(400).json({ error: 'Type at least 3 letters of the facility name, or a code' });
    return;
  }
  try {
    res.json({ facilities: await findFacilities(parsed.data) });
  } catch (err) {
    sendHieError(res, err);
  }
});

hieRouter.put('/facility', requireAdmin, async (req, res) => {
  const parsed = z.object({ frCode: z.string().trim().min(3).max(40) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose a facility' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    const facility = await setClinicFacility({ clinicId, staffId, frCode: parsed.data.frCode });
    res.json({ frCode: facility.frCode, name: facility.officialName });
  } catch (err) {
    sendHieError(res, err);
  }
});

const practitionerSchema = z.object({
  regulator: z.enum(HIE_REGULATORS),
  registrationNumber: z.string().trim().min(2).max(30),
});

/** A doctor or clinical officer verifies their own registration in the national Health Worker Registry. */
hieRouter.put('/me/practitioner', async (req, res) => {
  const { clinicId, staffId, role } = session(req);
  if (!PRACTITIONER_ROLES.includes(role)) {
    res.status(403).json({ error: 'Only doctors and clinical officers register with the Health Worker Registry' });
    return;
  }
  const parsed = practitionerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose your regulator and enter your registration number' });
    return;
  }
  try {
    res.json(await verifyOwnPractitionerRecord({ staffId, clinicId, ...parsed.data }));
  } catch (err) {
    sendHieError(res, err);
  }
});

/** Front desk: find the patient in the national Client Registry using the ID document on their record. */
hieRouter.post('/patients/:id/client-registry', async (req, res) => {
  const { clinicId, staffId, role } = session(req);
  if (!isFrontDeskRole(role)) {
    res.status(403).json({ error: 'Only front-desk staff can look patients up in the Client Registry' });
    return;
  }
  try {
    res.json(await lookUpPatientInClientRegistry({ patientId: req.params.id as string, clinicId, staffId }));
  } catch (err) {
    sendHieError(res, err);
  }
});

hieRouter.post('/patients/:id/client-registry/confirm', async (req, res) => {
  const { clinicId, staffId, role } = session(req);
  if (!isFrontDeskRole(role)) {
    res.status(403).json({ error: 'Only front-desk staff can look patients up in the Client Registry' });
    return;
  }
  try {
    res.json(await confirmPatientClientRegistryMatch({ patientId: req.params.id as string, clinicId, staffId }));
  } catch (err) {
    sendHieError(res, err);
  }
});

// ---------- SHA eligibility (claims phase 1), front desk ----------

/** Front desk only, like the Client Registry lookup; the patient must have been seen at this clinic. */
function shaRoute(handler: (args: { req: import('express').Request; patientId: string; clinicId: string; staffId: string }) => Promise<unknown>) {
  return async (req: import('express').Request, res: Response) => {
    const { clinicId, staffId, role } = session(req);
    if (!isFrontDeskRole(role)) {
      res.status(403).json({ error: 'Only front-desk staff can check SHA cover' });
      return;
    }
    try {
      res.json(await handler({ req, patientId: req.params.id as string, clinicId, staffId }));
    } catch (err) {
      sendHieError(res, err);
    }
  };
}

/** Is the patient covered by SHA today, under which schemes? */
hieRouter.post('/patients/:id/sha/eligibility', shaRoute(({ patientId, clinicId, staffId }) => checkShaEligibility({ patientId, clinicId, staffId })));

hieRouter.get('/patients/:id/sha/benefits', shaRoute(async ({ patientId, clinicId, staffId }) => ({ benefits: await listShaBenefits({ patientId, clinicId, staffId }) })));

hieRouter.get(
  '/patients/:id/sha/benefits/:benefitCode/sub-benefits',
  shaRoute(async ({ req, patientId, clinicId, staffId }) => ({
    subBenefits: await listShaSubBenefits({ patientId, clinicId, staffId, benefitCode: req.params.benefitCode as string }),
  })),
);

hieRouter.get(
  '/patients/:id/sha/sub-benefits/:subBenefitCode/interventions',
  shaRoute(async ({ req, patientId, clinicId, staffId }) => ({
    interventions: await listShaInterventions({
      patientId,
      clinicId,
      staffId,
      subBenefitCode: req.params.subBenefitCode as string,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    }),
  })),
);

// ---------- Shared Health Record, per visit ----------

/**
 * Front desk works on any visit at the clinic; a doctor only on visits in
 * their own queue (same rule as the consultation page). Lab technicians: none.
 */
async function canWorkOnVisit(req: unknown, res: Response, encounterId: string): Promise<boolean> {
  const { clinicId, staffId, role } = session(req);
  if (isFrontDeskRole(role)) return true;
  if (role === 'DOCTOR') {
    try {
      await assertEncounterInDoctorQueue(encounterId, clinicId, await getDoctorDepartmentIds(staffId), staffId);
      return true;
    } catch {
      res.status(404).json({ error: 'Visit not found' });
      return false;
    }
  }
  res.status(403).json({ error: 'Not available for your role' });
  return false;
}

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS (numbers only)') });

function visitRoute(handler: (args: { req: unknown; res: Response; encounterId: string; clinicId: string; staffId: string; role: string }) => Promise<unknown>) {
  return async (req: import('express').Request, res: Response) => {
    const encounterId = req.params.encounterId as string;
    if (!(await canWorkOnVisit(req, res, encounterId))) return;
    const { clinicId, staffId, role } = session(req);
    try {
      const out = await handler({ req, res, encounterId, clinicId, staffId, role });
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      sendHieError(res, err);
    }
  };
}

hieRouter.get(
  '/visits/:encounterId',
  visitRoute(({ encounterId, clinicId }) => getHieVisit(encounterId, clinicId)),
);

hieRouter.post(
  '/visits/:encounterId/consent',
  visitRoute(async ({ req, res, encounterId, clinicId, staffId, role }) => {
    const parsed = z.object({ emergencyReason: z.string().trim().min(3).max(200).optional() }).safeParse((req as { body: unknown }).body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Give a short reason the patient cannot consent' });
      return;
    }
    return startConsent({ encounterId, clinicId, staffId, staffRole: role, emergencyReason: parsed.data.emergencyReason });
  }),
);

hieRouter.post(
  '/visits/:encounterId/consent/resend',
  visitRoute(({ encounterId, clinicId, staffId }) => resendConsentCode({ encounterId, clinicId, staffId })),
);

hieRouter.post(
  '/visits/:encounterId/consent/confirm',
  visitRoute(async ({ req, res, encounterId, clinicId, staffId }) => {
    const parsed = codeSchema.safeParse((req as { body: unknown }).body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the code' });
      return;
    }
    return confirmConsentCode({ encounterId, clinicId, staffId, code: parsed.data.code });
  }),
);

hieRouter.post(
  '/visits/:encounterId/consent/refuse',
  visitRoute(async ({ req, res, encounterId, clinicId, staffId }) => {
    const parsed = z.object({ reason: z.string().trim().min(2).max(200) }).safeParse((req as { body: unknown }).body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Give a short reason (e.g. "Patient declined")' });
      return;
    }
    return recordConsentRefusal({ encounterId, clinicId, staffId, reason: parsed.data.reason });
  }),
);

/** Doctors only: the patient's records from other facilities, shown and never stored. */
hieRouter.get(
  '/visits/:encounterId/national-record',
  visitRoute(async ({ res, encounterId, clinicId, staffId, role }) => {
    if (role !== 'DOCTOR') {
      res.status(403).json({ error: 'Only doctors can read the national record' });
      return;
    }
    return { items: await readNationalRecord({ encounterId, clinicId, staffId }) };
  }),
);

hieRouter.post(
  '/visits/:encounterId/send',
  visitRoute(({ encounterId, clinicId, staffId }) => retrySend({ encounterId, clinicId, staffId }, enqueueHieShrSend)),
);

hieRouter.post(
  '/visits/:encounterId/close',
  visitRoute(({ encounterId, clinicId, staffId }) => startClose({ encounterId, clinicId, staffId })),
);

hieRouter.post(
  '/visits/:encounterId/close/confirm',
  visitRoute(async ({ req, res, encounterId, clinicId, staffId }) => {
    const parsed = codeSchema.safeParse((req as { body: unknown }).body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the code' });
      return;
    }
    return confirmCloseCode({ encounterId, clinicId, staffId, code: parsed.data.code });
  }),
);
