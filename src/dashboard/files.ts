import { Response, Router } from 'express';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import {
  downloadName,
  fileView,
  listPatientFiles,
  openPatientFile,
  PatientFileError,
  removeQuietly,
  savePatientFile,
  savePhotosAsPdf,
  staffCanSeePatient,
} from '../services/fileStorageService';
import { parseFileMeta, setFileHeaders, uploadOneFile, uploadPhotos } from '../utils/upload';

/**
 * Patient files on the console. Front desk and admins (patients this clinic
 * has seen) and doctors (patients in their own queue) can upload and view.
 * What a clinic sees follows the records rule: its own uploads always,
 * others only on the patient's sharing consent or a records code. The
 * clinic and staff member always come from the session.
 */
export const filesRouter = Router();

filesRouter.use(requireStaffSession);

function viewer(req: unknown) {
  const { clinicId, staffId, role } = (req as AuthenticatedRequest).dashboardSession;
  return { kind: 'staff' as const, clinicId, staffId, role };
}

function sendFileError(err: unknown, res: Response): boolean {
  if (err instanceof PatientFileError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

filesRouter.get('/patient/:patientId', async (req, res) => {
  const v = viewer(req);
  if (!(await staffCanSeePatient(req.params.patientId as string, v))) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }
  const { files, hiddenCount } = await listPatientFiles(req.params.patientId as string, v);
  res.json({ files: files.map((f) => fileView(f, v.clinicId)), hiddenCount });
});

/** One JPG, PNG or PDF with category, date and optional note. */
filesRouter.post('/patient/:patientId', uploadOneFile, async (req, res) => {
  const v = viewer(req);
  try {
    if (!req.file) throw new PatientFileError('Choose a file to upload', 400);
    if (!(await staffCanSeePatient(req.params.patientId as string, v))) throw new PatientFileError('Patient not found', 404);
    const meta = parseFileMeta(req.body);
    const row = await savePatientFile(req.file.path, req.params.patientId as string, meta, { type: 'STAFF', staffId: v.staffId, clinicId: v.clinicId });
    res.status(201).json(fileView(row, v.clinicId));
  } catch (err) {
    await removeQuietly(req.file?.path);
    if (!sendFileError(err, res)) throw err;
  }
});

/** "Previous records": several photos of a paper file, combined into one PDF. */
filesRouter.post('/patient/:patientId/photos', uploadPhotos, async (req, res) => {
  const v = viewer(req);
  const photos = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    if (!(await staffCanSeePatient(req.params.patientId as string, v))) throw new PatientFileError('Patient not found', 404);
    const { documentDate, note } = parseFileMeta(req.body, 'PREVIOUS_RECORDS');
    const row = await savePhotosAsPdf(
      photos.map((p) => p.path),
      req.params.patientId as string,
      { documentDate, note },
      { type: 'STAFF', staffId: v.staffId, clinicId: v.clinicId },
    );
    res.status(201).json(fileView(row, v.clinicId));
  } catch (err) {
    for (const p of photos) await removeQuietly(p.path);
    if (!sendFileError(err, res)) throw err;
  }
});

filesRouter.get('/:fileId', async (req, res) => {
  try {
    const { file, stream } = await openPatientFile(req.params.fileId as string, viewer(req));
    setFileHeaders(res, file.mimeType, downloadName(file), file.sizeBytes);
    stream.pipe(res);
  } catch (err) {
    if (!sendFileError(err, res)) throw err;
  }
});
