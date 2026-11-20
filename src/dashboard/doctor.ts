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
import { ICD11_RELEASE, Icd11Entry, MAX_DIAGNOSIS_CODES, resolveDiagnosisCodes, searchIcd11 } from '../services/icd11Service';
import { AllergyError, recordAllergy, removeAllergy } from '../services/allergyService';
import { closeServiceOrder, createServiceOrder, ServiceOrderError } from '../services/serviceOrderService';
import { addProblem, ProblemListError, updateProblem } from '../services/problemListService';
import {
  AllergyOverrideRequiredError,
  checkPrescriptionAllergies,
  DOSE_UNITS,
  FREQUENCIES,
  MAX_PRESCRIPTION_ITEMS,
  prescriptionItemsSchema,
  ResolvedPrescriptionItem,
  resolvePrescriptionItems,
  ROUTES,
} from '../services/prescriptionService';
import { dhaDisplay, dhaTerminologyList, searchProducts, suggestedDoseUnit, suggestedRoute } from '../services/dhaTerminology';
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
  /** ICD-11 MMS codes picked from the list (1 to 5); titles come from WHO's file, never from the browser. */
  diagnosisCodes: z.array(z.string().trim().min(1).max(20)).min(1).max(MAX_DIAGNOSIS_CODES),
  /** The doctor's own notes (optional now that the diagnosis is coded). */
  diagnosis: z.string().trim().max(2000).optional().default(''),
  /** One line per medicine (DHA-coded where picked from the list). */
  prescriptionItems: prescriptionItemsSchema,
  /** General advice for the patient, printed after the medicines (optional). */
  prescriptionAdvice: z.string().trim().max(1000).nullish(),
  /** Plan / follow-up for the patient (optional). */
  carePlan: z.string().trim().max(1000).nullish(),
  // The doctor's own PIN, re-entered as the act of signing — required on
  // every submission, not optional. See encounterService.submitConsultation.
  pin: z.string().min(1),
});

doctorRouter.post('/encounters/:id/consult', async (req, res) => {
  const parsed = consultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'An ICD-11 diagnosis, at least one medicine (dose, how often, route), and your PIN are required' });
    return;
  }

  let codes: Icd11Entry[];
  let items: ResolvedPrescriptionItem[];
  try {
    codes = resolveDiagnosisCodes(parsed.data.diagnosisCodes);
    items = resolvePrescriptionItems(parsed.data.prescriptionItems);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const encounter = await submitConsultation({
      diagnosisCodes: codes,
      encounterId: req.params.id as string,
      clinicId,
      departmentIds: departmentsOf(res),
      staffId,
      diagnosis: parsed.data.diagnosis,
      prescriptionItems: items,
      prescriptionAdvice: parsed.data.prescriptionAdvice,
      carePlan: parsed.data.carePlan,
      pin: parsed.data.pin,
    });
    res.json({ encounterId: encounter.id, status: encounter.status, notifiable: encounter.notifiable });
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
    if (err instanceof AllergyOverrideRequiredError) {
      res.status(409).json({ error: err.message, allergyConflicts: err.conflicts });
      return;
    }
    throw err;
  }
});

/** Medicine search for the prescription form: DHA's Kenya medicines list (Generic Products). */
doctorRouter.get('/medicines', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json({
    results: searchProducts(q, 20).map((p) => ({ ...p, suggestedRoute: suggestedRoute(p.name), suggestedDoseUnit: suggestedDoseUnit(p.name) })),
  });
});

/** The choices for a prescription line (DHA codes and names). */
doctorRouter.get('/prescription-options', (_req, res) => {
  res.json({
    routes: ROUTES.map((code) => ({ code, name: dhaDisplay('routes', code) ?? code })),
    doseUnits: Object.entries(DOSE_UNITS).map(([code, u]) => ({ code, name: u.many, one: u.one })),
    frequencies: Object.entries(FREQUENCIES).map(([code, f]) => ({ code, name: f.label, perDay: f.perDay })),
    instructions: dhaTerminologyList('instructions'),
  });
});

const checkSchema = z.object({
  items: z.array(z.object({ productCode: z.string().max(20).nullish(), drugName: z.string().max(120).nullish() })).max(MAX_PRESCRIPTION_ITEMS),
});

/** Live allergy check while the doctor writes the prescription (the same check runs again at signing). */
doctorRouter.post('/encounters/:id/prescription-check', async (req, res) => {
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid medicines' });
    return;
  }
  const patientId = await patientInMyQueue(req, res);
  if (!patientId) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const lines = parsed.data.items.map((i) => ({ drugName: (i.productCode && dhaDisplay('products', i.productCode)) || i.drugName || '' }));
  const { clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  res.json({ allergyConflicts: await checkPrescriptionAllergies(patientId, clinicId, lines) });
});

/** ICD-11 diagnosis search for the consultation form (WHO's official codes and titles). */
doctorRouter.get('/icd11', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json({ results: searchIcd11(q, 20), release: ICD11_RELEASE });
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

const serviceOrderSchema = z.object({
  category: z.enum(['RADIOLOGY', 'PHYSIOTHERAPY', 'OCCUPATIONAL_THERAPY', 'NUTRITION', 'SOCIAL_WORK', 'COUNSELLING']),
  description: z.string(),
  note: z.string().nullish(),
  urgent: z.boolean().optional(),
});

function sendServiceOrderError(err: unknown, res: Response): boolean {
  if (err instanceof ServiceOrderError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/** Radiology, therapy, nutrition, social work or counselling order for a visit in this doctor's queue. */
doctorRouter.post('/encounters/:id/orders', async (req, res) => {
  const parsed = serviceOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose the type of order and say what is ordered' });
    return;
  }
  if (!(await patientInMyQueue(req, res))) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json({ orders: await createServiceOrder({ encounterId: req.params.id as string, clinicId, staffId, ...parsed.data }) });
  } catch (err) {
    if (!sendServiceOrderError(err, res)) throw err;
  }
});

/** Withdraw an order before signing. It stays on the visit, marked cancelled. */
doctorRouter.post('/encounters/:id/orders/:orderId/cancel', async (req, res) => {
  if (!(await patientInMyQueue(req, res))) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json({ orders: await closeServiceOrder({ orderId: req.params.orderId as string, encounterId: req.params.id as string, clinicId, staffId, outcome: 'CANCELLED' }) });
  } catch (err) {
    if (!sendServiceOrderError(err, res)) throw err;
  }
});

function sendProblemError(err: unknown, res: Response): boolean {
  if (err instanceof ProblemListError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

const addProblemSchema = z.object({ icd11Code: z.string().min(1).max(20), note: z.string().nullish(), onsetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });

/** Adds a problem (ICD-11) to the problem list of the patient of a visit in this doctor's queue. */
doctorRouter.post('/encounters/:id/problems', async (req, res) => {
  const parsed = addProblemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose the condition from the ICD-11 list' });
    return;
  }
  const patientId = await patientInMyQueue(req, res);
  if (!patientId) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json(await addProblem({ patientId, clinicId, staffId, ...parsed.data }));
  } catch (err) {
    if (!sendProblemError(err, res)) throw err;
  }
});

const updateProblemSchema = z.union([
  z.object({ status: z.enum(['ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR']) }),
  z.object({ note: z.string().nullable() }),
]);

/** Resolve, make active again, mark entered in error, or change the note. Kept in the problem's history. */
doctorRouter.patch('/encounters/:id/problems/:problemId', async (req, res) => {
  const parsed = updateProblemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Nothing to change' });
    return;
  }
  const patientId = await patientInMyQueue(req, res);
  if (!patientId) {
    res.status(404).json({ error: 'Patient not found in your queue' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await updateProblem({ problemId: req.params.problemId as string, patientId, clinicId, staffId, change: parsed.data }));
  } catch (err) {
    if (!sendProblemError(err, res)) throw err;
  }
});
