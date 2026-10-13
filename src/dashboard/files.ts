import { Response, Router } from 'express';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { clinicCanSeePatientWhere } from '../services/clinicPatientService';
import {
  downloadName,
  fileView,
  listPatientFiles,
  openPatientFile,
  PatientFileError,
  removeQuietly,
  savePatientFile,
  savePhotosAsPdf,
} from '../services/fileStorageService';
import { parseFileMeta, setFileHeaders, uploadOneFile, uploadPhotos } from '../utils/upload';

/**
 * Patient files on the console. Front desk, admins and doctors can upload
 * and view; what a clinic sees follows the records rule (its own uploads
 * always, others only with the patient's approval). The clinic and staff
 * member always come from the session.
 */
export const filesRouter = Router();

filesRouter.use(requireStaffSession);

function session(req: unknown) {
  return (req as AuthenticatedRequest).dashboardSession;
}

function sendFileError(err: unknown, res: Response): boolean {
  if (err instanceof PatientFileError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

async function patientKnownToClinic(patientId: string, clinicId: string): Promise<boolean> {
  return Boolean(await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null, ...clinicCanSeePatientWhere(clinicId) }, select: { id: true } }));
}

filesRouter.get('/patient/:patientId', async (req, res) => {
  const { clinicId } = session(req);
  if (!(await patientKnownToClinic(req.params.patientId as string, clinicId))) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }
  const { files, hiddenCount } = await listPatientFiles(req.params.patientId as string, { kind: 'clinic', clinicId, staffId: session(req).staffId });
  res.json({ files: files.map((f) => fileView(f, clinicId)), hiddenCount });
});

/** One JPG, PNG or PDF with category, date and optional note. */
filesRouter.post('/patient/:patientId', uploadOneFile, async (req, res) => {
  const { clinicId, staffId } = session(req);
  try {
    if (!req.file) throw new PatientFileError('Choose a file to upload', 400);
    if (!(await patientKnownToClinic(req.params.patientId as string, clinicId))) throw new PatientFileError('Patient not found', 404);
    const meta = parseFileMeta(req.body);
    const row = await savePatientFile(req.file.path, req.params.patientId as string, meta, { type: 'STAFF', staffId, clinicId });
    res.status(201).json(fileView(row, clinicId));
  } catch (err) {
    await removeQuietly(req.file?.path);
    if (!sendFileError(err, res)) throw err;
  }
});

/** "Previous records": several photos of a paper file, combined into one PDF. */
filesRouter.post('/patient/:patientId/photos', uploadPhotos, async (req, res) => {
  const { clinicId, staffId } = session(req);
  const photos = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    if (!(await patientKnownToClinic(req.params.patientId as string, clinicId))) throw new PatientFileError('Patient not found', 404);
    const { documentDate, note } = parseFileMeta(req.body, 'PREVIOUS_RECORDS');
    const row = await savePhotosAsPdf(
      photos.map((p) => p.path),
      req.params.patientId as string,
      { documentDate, note },
      { type: 'STAFF', staffId, clinicId },
    );
    res.status(201).json(fileView(row, clinicId));
  } catch (err) {
    for (const p of photos) await removeQuietly(p.path);
    if (!sendFileError(err, res)) throw err;
  }
});

filesRouter.get('/:fileId', async (req, res) => {
  const { clinicId, staffId } = session(req);
  try {
    const { file, stream } = await openPatientFile(req.params.fileId as string, { kind: 'clinic', clinicId, staffId });
    setFileHeaders(res, file.mimeType, downloadName(file), file.sizeBytes);
    stream.pipe(res);
  } catch (err) {
    if (!sendFileError(err, res)) throw err;
  }
});
