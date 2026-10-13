import crypto from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { PatientFileCategory } from '@prisma/client';
import { ensureStorageDirs, FileMeta, incomingDir, MAX_FILE_BYTES, MAX_PHOTOS_PER_PDF, PatientFileError } from '../services/fileStorageService';
import { parseDateOfBirth } from './patientInput';

/**
 * Patient file uploads land on this server's disk, in the private storage
 * folder's .incoming directory under a random name, and are only moved into
 * storage after their content has been checked (fileStorageService).
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureStorageDirs()
        .then(() => cb(null, incomingDir()))
        .catch((err: Error) => cb(err, incomingDir()));
    },
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_PHOTOS_PER_PDF, fields: 10, fieldSize: 2000 },
});

function wrap(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') res.status(413).json({ error: 'Files can be at most 20 MB each' });
      else if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') res.status(400).json({ error: `Upload one file, or up to ${MAX_PHOTOS_PER_PDF} photos` });
      else next(err);
    });
  };
}

export const uploadOneFile = wrap(upload.single('file'));
export const uploadPhotos = wrap(upload.array('photos', MAX_PHOTOS_PER_PDF));

const metaSchema = z.object({
  category: z.nativeEnum(PatientFileCategory, { errorMap: () => ({ message: 'Choose a category' }) }),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date of the document'),
  note: z.string().trim().max(300, 'Keep the note under 300 characters').optional(),
});

/** Reads category / date / note from the form fields. */
export function parseFileMeta(body: unknown, fixedCategory?: PatientFileCategory): FileMeta {
  const parsed = metaSchema.safeParse({ ...(body as object), ...(fixedCategory ? { category: fixedCategory } : {}) });
  if (!parsed.success) throw new PatientFileError(parsed.error.issues[0]?.message ?? 'Check the file details', 400);
  const documentDate = parseDateOfBirth(parsed.data.documentDate);
  if (!documentDate) throw new PatientFileError('Enter a real date, not in the future', 400);
  return { category: parsed.data.category, documentDate, note: parsed.data.note || null };
}

/** Headers for serving a stored file: no caching, no sniffing, no scripts even inside a PDF viewer. */
export function setFileHeaders(res: Response, mimeType: string, name: string, sizeBytes: number): void {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(sizeBytes));
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w .-]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Only our three checked types are ever served, and nosniff stops a browser
  // treating them as anything else. Images also get a locked-down policy;
  // PDFs don't, because browsers refuse to show a PDF under "sandbox".
  if (mimeType.startsWith('image/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
}
