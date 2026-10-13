import { Response, Router } from 'express';
import { AuthenticatedPatientRequest, requirePatientSession } from './auth';
import { downloadName, fileView, listPatientFiles, openPatientFile, PatientFileError, removeQuietly, savePatientFile } from '../services/fileStorageService';
import { parseFileMeta, setFileHeaders, uploadOneFile } from '../utils/upload';

/** The patient's own files: they see all of them, and can add their own (labelled "Patient-uploaded"). */
export const portalFilesRouter = Router();

portalFilesRouter.use(requirePatientSession);

function patientId(req: unknown): string {
  return (req as AuthenticatedPatientRequest).patientSession.patientId;
}

function sendFileError(err: unknown, res: Response): boolean {
  if (err instanceof PatientFileError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

portalFilesRouter.get('/', async (req, res) => {
  const { files } = await listPatientFiles(patientId(req), { kind: 'patient', patientId: patientId(req) });
  res.json({ files: files.map((f) => fileView(f)) });
});

portalFilesRouter.post('/', uploadOneFile, async (req, res) => {
  try {
    if (!req.file) throw new PatientFileError('Choose a file to upload', 400);
    const meta = parseFileMeta(req.body);
    const row = await savePatientFile(req.file.path, patientId(req), meta, { type: 'PATIENT', clinicId: null });
    res.status(201).json(fileView(row));
  } catch (err) {
    await removeQuietly(req.file?.path);
    if (!sendFileError(err, res)) throw err;
  }
});

portalFilesRouter.get('/:fileId', async (req, res) => {
  try {
    const { file, stream } = await openPatientFile(req.params.fileId as string, { kind: 'patient', patientId: patientId(req) });
    setFileHeaders(res, file.mimeType, downloadName(file), file.sizeBytes);
    stream.pipe(res);
  } catch (err) {
    if (!sendFileError(err, res)) throw err;
  }
});
