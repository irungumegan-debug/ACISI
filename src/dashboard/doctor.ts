import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  EncounterNotAccessibleError,
  EncounterNotConsultableError,
  InvalidPinError,
  PinLockedOutError,
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
} from '../services/encounterService';
import { findActiveStaffById, getDoctorPresenceStatus, setDoctorPresenceBySelf } from '../services/staffService';
import { listDepartmentAppointmentsToday } from '../services/appointmentService';
import { getDoctorDepartmentIds } from '../services/departmentService';
import { listLabTests, requestLabTests } from '../services/labService';
import { sendLabError } from './lab';
import { AllergyError, recordAllergy, removeAllergy } from '../services/allergyService';
import { doctorQueueFilter } from '../services/doctorScope';
import { prisma } from '../db/prisma';

export const doctorRouter = Router();

doctorRouter.use(requireStaffSession);

/**
 * A doctor is always department-scoped. Their departments are read fresh on
 * every request (an admin can change them any time) and kept on
 * res.locals.departmentIds; a doctor with none — or any other role — can't
 * reach these routes.
 */
async function requireDoctor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { role, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const departmentIds = role === 'DOCTOR' ? await getDoctorDepartmentIds(staffId) : [];
  if (departmentIds.length === 0) {
    res.status(403).json({ error: 'Doctor access required' });
    return;
  }
  res.locals.departmentIds = departmentIds;
  next();
}

const departmentsOf = (res: Response): string[] => res.locals.departmentIds as string[];

doctorRouter.use((req, res, next) => {
  requireDoctor(req, res, next).catch(next);
});

doctorRouter.get('/queue', async (req, res) => {
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const [queue, staff] = await Promise.all([
    getDoctorQueue(clinicId, departmentsOf(res), staffId),
    findActiveStaffById(staffId),
  ]);
  res.json({ queue, presence: staff ? getDoctorPresenceStatus(staff) : 'NOT_IN_YET' });
});

const presenceSchema = z.object({ status: z.enum(['IN', 'OUT']) });

/** A doctor marking themselves in/out for today, e.g. after logging in this morning but then having to leave sick. */
doctorRouter.post('/presence', async (req, res) => {
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be IN or OUT' });
    return;
  }

  const { staffId } = (req as AuthenticatedRequest).dashboardSession;
  const result = await setDoctorPresenceBySelf(staffId, parsed.data.status);
  res.json(result);
});

/** Read-only: today's CONFIRMED appointments in the doctor's own department — separate from their live WAITING/IN_CONSULTATION queue. */
doctorRouter.get('/appointments/today', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const appointments = await listDepartmentAppointmentsToday(clinicId, departmentsOf(res));
  res.json({ appointments });
});

doctorRouter.get('/encounters/:id', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const detail = await getEncounterForDoctor(req.params.id as string, clinicId, departmentsOf(res), staffId);
    res.json(detail);
  } catch (err) {
    if (err instanceof EncounterNotAccessibleError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const consultSchema = z.object({
  diagnosis: z.string().min(1),
  prescription: z.string().min(1),
  // The doctor's own PIN, re-entered as the act of signing — required on
  // every submission, not optional. See encounterService.submitConsultation.
  pin: z.string().min(1),
});

doctorRouter.post('/encounters/:id/consult', async (req, res) => {
  const parsed = consultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Diagnosis, prescription, and your PIN are required' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const encounter = await submitConsultation({
      encounterId: req.params.id as string,
      clinicId,
      departmentIds: departmentsOf(res),
      staffId,
      diagnosis: parsed.data.diagnosis,
      prescription: parsed.data.prescription,
      pin: parsed.data.pin,
    });
    res.json({ encounterId: encounter.id, status: encounter.status });
  } catch (err) {
    if (err instanceof EncounterNotAccessibleError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof EncounterNotConsultableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidPinError) {
      res.status(401).json({ error: err.message });
      return;
    }
    if (err instanceof PinLockedOutError) {
      res.status(429).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** The clinic's active lab tests, for the "Request lab tests" picker. */
doctorRouter.get('/lab-tests', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  res.json({ tests: await listLabTests(clinicId) });
});

const labOrderSchema = z.object({
  labTestIds: z.array(z.string().min(1)).min(1).max(30),
  noteForLab: z.string().nullish(),
  // The doctor's own PIN, re-entered as the act of requesting.
  pin: z.string().min(1),
});

/** Sends the patient to the lab: the visit leaves this doctor's queue until the results are signed. */
doctorRouter.post('/encounters/:id/lab-orders', async (req, res) => {
  const parsed = labOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose at least one test and enter your PIN' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    const result = await requestLabTests({
      encounterId: req.params.id as string,
      clinicId,
      departmentIds: departmentsOf(res),
      staffId,
      labTestIds: parsed.data.labTestIds,
      noteForLab: parsed.data.noteForLab,
      pin: parsed.data.pin,
    });
    res.status(201).json(result);
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

/** The patient of a visit in this doctor's own queue, or null. */
async function patientInMyQueue(req: Request, res: Response): Promise<string | null> {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const encounter = await prisma.encounter.findFirst({
    where: { id: req.params.id as string, ...doctorQueueFilter(clinicId, departmentsOf(res), staffId) },
    select: { patientId: true },
  });
  return encounter?.patientId ?? null;
}

function sendAllergyError(err: unknown, res: Response): boolean {
  if (err instanceof AllergyError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const allergySchema = z.object({
  category: z.enum(['MEDICATION', 'FOOD', 'ENVIRONMENT', 'OTHER']),
  substance: z.string(),
  reaction: z.string().nullish(),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']),
});

/** Records an allergy for the patient of a visit in this doctor's queue. */
doctorRouter.post('/encounters/:id/allergies', async (req, res) => {
  const parsed = allergySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose the type and severity, and enter the substance' });
    return;
  }
  const patientId = await patientInMyQueue(req, res);
  if (!patientId) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json(await recordAllergy({ patientId, clinicId, staffId, ...parsed.data }));
  } catch (err) {
    if (!sendAllergyError(err, res)) throw err;
  }
});

const removeAllergySchema = z.object({ reason: z.string() });

/** Marks an allergy (recorded at this clinic) as removed, e.g. recorded in error. It stays in the history. */
doctorRouter.post('/encounters/:id/allergies/:allergyId/remove', async (req, res) => {
  const parsed = removeAllergySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give a reason' });
    return;
  }
  const patientId = await patientInMyQueue(req, res);
  if (!patientId) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await removeAllergy({ allergyId: req.params.allergyId as string, patientId, clinicId, staffId, reason: parsed.data.reason }));
  } catch (err) {
    if (!sendAllergyError(err, res)) throw err;
  }
});
