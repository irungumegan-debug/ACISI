import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import multer from 'multer';
import { addPatient, linkExistingPatient, lookupPatients, PatientRegistryError } from '../services/clinicPatientService';
import { confirmImport, countPendingInvitations, previewImport, sendPendingInvitations } from '../services/patientImportService';

/**
 * The clinic's patient list: look up by phone or ACISI ID, "Add patient",
 * and link an existing ACISI patient to this clinic. Front-desk roles only
 * (receptionists, clinicians, admins) — doctors are refused on the server.
 */
export const registryRouter = Router();

registryRouter.use(requireStaffSession);

export function requireFrontDesk(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).dashboardSession.role === 'DOCTOR') {
    res.status(403).json({ error: 'Only front-desk staff can do this' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).dashboardSession.role !== 'ADMIN') {
    res.status(403).json({ error: 'Only a clinic admin can do this' });
    return;
  }
  next();
}

registryRouter.use(requireFrontDesk);

export function sendRegistryError(err: unknown, res: Response): boolean {
  if (err instanceof PatientRegistryError) {
    res.status(err.status).json({ error: err.message, ...(err.details ?? {}) });
    return true;
  }
  return false;
}

/** Phone number (any Kenyan format) or ACISI ID → every patient it matches. */
registryRouter.get('/lookup', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (!q.trim()) {
    res.status(400).json({ error: 'Enter a phone number or ACISI ID' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await lookupPatients(q, clinicId, staffId));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});

export const addPatientSchema = z.object({
  fullName: z.string().trim().min(3, "Enter the patient's full name").max(100),
  phone: z.string().trim().min(1, 'Enter a phone number').max(20),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth'),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER'], { errorMap: () => ({ message: 'Choose the patient’s sex' }) }),
  registrationConsent: z.boolean().default(false),
  privacyNoticeExplained: z.boolean().default(false),
  smsOptOut: z.boolean().default(false),
  confirmedNewPersonOnPhone: z.boolean().default(false),
  /** The walk-in flow sends a queue SMS instead, so it skips the registration SMS. */
  skipRegistrationSms: z.boolean().default(false),
});

registryRouter.post('/patients', async (req, res) => {
  const parsed = addPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json(await addPatient({ ...parsed.data, clinicId, staffId }));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});

/** "This is them": link a patient already on ACISI to this clinic instead of creating a duplicate. */
registryRouter.post('/patients/:id/link', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await linkExistingPatient(clinicId, staffId, req.params.id as string));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});

// --- Bulk import and invitations (clinic admin only) -------------------------

/** Patient lists are small text/spreadsheet files; kept in memory, never written to disk. */
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

registryRouter.post('/import/preview', requireAdmin, (req, res, next) => {
  importUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const tooBig = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
      res.status(400).json({ error: tooBig ? 'The file is too big (max 5 MB). Split it into smaller files.' : 'Upload one .csv or .xlsx file' });
      return;
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Choose a .csv or .xlsx file to upload' });
    return;
  }
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await previewImport(req.file, clinicId));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});

const confirmSchema = z.object({ clinicConfirmsBasis: z.boolean().default(false) });

registryRouter.post('/import/:importId/confirm', requireAdmin, async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body ?? {});
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await confirmImport(req.params.importId as string, clinicId, staffId, { clinicConfirmsBasis: parsed.success && parsed.data.clinicConfirmsBasis }));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});

registryRouter.get('/invitations', requireAdmin, async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  res.json({ pending: await countPendingInvitations(clinicId) });
});

const sendInvitesSchema = z.object({ cursor: z.string().max(64).optional() });

registryRouter.post('/invitations/send', requireAdmin, async (req, res) => {
  const parsed = sendInvitesSchema.safeParse(req.body ?? {});
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await sendPendingInvitations(clinicId, staffId, parsed.success ? parsed.data.cursor : undefined));
  } catch (err) {
    if (!sendRegistryError(err, res)) throw err;
  }
});
