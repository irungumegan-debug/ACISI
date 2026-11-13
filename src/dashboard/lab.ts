import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import {
  completeLabOrder,
  createLabTest,
  getLabQueue,
  LabError,
  listLabTests,
  openLabOrder,
  patientOfOpenOrder,
  saveLabResults,
  updateLabTest,
} from '../services/labService';
import { InvalidPinError, PinLockedOutError } from '../services/signingPin';
import { downloadName, fileView, PatientFileError, removeQuietly, savePatientFile, streamStoredFile } from '../services/fileStorageService';
import { recordAuditEvent } from '../services/auditService';
import { setFileHeaders, uploadOneFile } from '../utils/upload';

function session(req: unknown) {
  return (req as AuthenticatedRequest).dashboardSession;
}

/** Maps the lab's known errors to HTTP answers; anything else goes to the error handler. */
export function sendLabError(err: unknown, res: Response): boolean {
  if (err instanceof LabError || err instanceof PatientFileError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidPinError) {
    res.status(401).json({ error: err.message });
    return true;
  }
  if (err instanceof PinLockedOutError) {
    res.status(429).json({ error: err.message });
    return true;
  }
  return false;
}

// --- The lab queue (lab technicians only) -------------------------------------

export const labRouter = Router();

labRouter.use(requireStaffSession);

function requireLabTechnician(req: Request, res: Response, next: NextFunction): void {
  if (session(req).role !== 'LAB_TECHNICIAN') {
    res.status(403).json({ error: 'Lab technician access required' });
    return;
  }
  next();
}

labRouter.use(requireLabTechnician);

labRouter.get('/queue', async (req, res) => {
  res.json({ queue: await getLabQueue(session(req).clinicId) });
});

labRouter.get('/orders/:id', async (req, res) => {
  const { clinicId, staffId } = session(req);
  try {
    res.json(await openLabOrder(req.params.id as string, clinicId, staffId));
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        itemId: z.string().min(1),
        value: z.string().nullish(),
        unit: z.string().nullish(),
        flag: z.enum(['NORMAL', 'ABNORMAL', 'CRITICAL']).nullish(),
        comment: z.string().nullish(),
      }),
    )
    .max(30),
});

labRouter.put('/orders/:id/results', async (req, res) => {
  const parsed = resultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the results and try again' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    await saveLabResults({ labOrderId: req.params.id as string, clinicId, staffId, results: parsed.data.results });
    res.status(204).send();
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

const completeSchema = z.object({ pin: z.string().min(1) });

/** "Results ready": signs the results with the lab technician's PIN, sends them to the doctor and texts the patient. */
labRouter.post('/orders/:id/complete', async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your PIN to sign the results' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    res.json(await completeLabOrder({ labOrderId: req.params.id as string, clinicId, staffId, pin: parsed.data.pin }));
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

/** Attach a printout (PDF or photo) to an open lab request. Filed under "Lab report" on the patient's record. */
labRouter.post('/orders/:id/files', uploadOneFile, async (req, res) => {
  const { clinicId, staffId } = session(req);
  try {
    if (!req.file) throw new PatientFileError('Choose a file to upload', 400);
    const patientId = await patientOfOpenOrder(req.params.id as string, clinicId);
    const row = await savePatientFile(
      req.file.path,
      patientId,
      { category: 'LAB_REPORT', documentDate: new Date(), note: null, labOrderId: req.params.id as string },
      { type: 'STAFF', staffId, clinicId },
    );
    res.status(201).json(fileView(row, clinicId));
  } catch (err) {
    await removeQuietly(req.file?.path);
    if (!sendLabError(err, res)) throw err;
  }
});

/** The lab can open only files attached to an open request at its own clinic. */
labRouter.get('/orders/:id/files/:fileId', async (req, res) => {
  const { clinicId, staffId } = session(req);
  try {
    await patientOfOpenOrder(req.params.id as string, clinicId);
    const file = await prisma.patientFile.findFirst({ where: { id: req.params.fileId as string, labOrderId: req.params.id as string, clinicId } });
    if (!file) throw new PatientFileError('File not found', 404);
    const stream = await streamStoredFile(file);
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: staffId,
      staffId,
      clinicId,
      action: 'PATIENT_FILE_VIEWED',
      entityType: 'PatientFile',
      entityId: file.id,
      metadata: { patientId: file.patientId, labOrderId: file.labOrderId, ownClinicFile: true },
    });
    setFileHeaders(res, file.mimeType, downloadName(file), file.sizeBytes);
    stream.pipe(res);
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

// --- The clinic's test list (admin) --------------------------------------------

export const labTestsAdminRouter = Router();

labTestsAdminRouter.use(requireStaffSession, requireAdmin);

labTestsAdminRouter.get('/', async (req, res) => {
  res.json({ tests: await listLabTests(session(req).clinicId, { includeInactive: true }) });
});

const newTestSchema = z.object({ name: z.string(), priceKes: z.coerce.number() });

labTestsAdminRouter.post('/', async (req, res) => {
  const parsed = newTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a test name and price' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    res.status(201).json(await createLabTest({ clinicId, staffId, name: parsed.data.name, priceKes: parsed.data.priceKes }));
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});

const patchTestSchema = z.object({ name: z.string().optional(), priceKes: z.coerce.number().optional(), isActive: z.boolean().optional() });

labTestsAdminRouter.patch('/:id', async (req, res) => {
  const parsed = patchTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the test details' });
    return;
  }
  const { clinicId, staffId } = session(req);
  try {
    res.json(await updateLabTest({ clinicId, staffId, labTestId: req.params.id as string, ...parsed.data }));
  } catch (err) {
    if (!sendLabError(err, res)) throw err;
  }
});
