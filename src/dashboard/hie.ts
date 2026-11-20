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
