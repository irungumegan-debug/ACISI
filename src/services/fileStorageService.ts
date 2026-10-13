import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { ActorType, PatientFile, PatientFileCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { recordAuditEvent } from './auditService';
import { clinicCanSeePatientWhere } from './clinicPatientService';
import { clinicHasRecordAccess } from './patientService';

/**
 * Patient files (X-rays, scans, lab reports, photos of old paper files).
 *
 * - Bytes live on THIS server's disk, in env.FILE_STORAGE_DIR (mode 0700,
 *   outside the web root), under random names with no extension. Nothing
 *   goes to any cloud service.
 * - Only JPG, PNG and PDF, recognised by their content (magic bytes), not
 *   by the file name. At most 20 MB each.
 * - Served only through logged-in routes that apply the same rule as visit
 *   records: the uploading clinic and the patient always; any other clinic
 *   only with the patient's approval (recordAccessService).
 * - Every upload and every view is in the audit log.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** "Previous records" photos combined into one PDF in a single go. */
export const MAX_PHOTOS_PER_PDF = 30;
/**
 * And at most this much in total. The server has 1 GB of RAM (the app is
 * capped at 500 MB), so photos are read one at a time while the PDF is
 * written straight to disk — never all held in memory together.
 */
export const MAX_PHOTOS_TOTAL_BYTES = 100 * 1024 * 1024;

export type AllowedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export class PatientFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 413,
  ) {
    super(message);
    this.name = 'PatientFileError';
  }
}

export const CATEGORY_LABEL: Record<PatientFileCategory, string> = {
  XRAY: 'X-ray',
  CT_SCAN: 'CT scan',
  MRI: 'MRI',
  ULTRASOUND: 'Ultrasound',
  LAB_REPORT: 'Lab report',
  PREVIOUS_RECORDS: 'Previous records',
  OTHER: 'Other',
};

/** Recognises a file by its first bytes. Anything else — whatever its name says — is refused. */
export function detectFileType(head: Buffer): AllowedMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export function storageDir(): string {
  return path.resolve(env.FILE_STORAGE_DIR);
}

/** Where uploads land before they're checked. Same disk, so the final move is a rename. */
export function incomingDir(): string {
  return path.join(storageDir(), '.incoming');
}

export async function ensureStorageDirs(): Promise<void> {
  await fs.promises.mkdir(incomingDir(), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(storageDir(), 0o700).catch(() => undefined);
}

function filePath(storageName: string): string {
  // storageName is our own random hex, but never trust it into a path blindly.
  if (!/^[a-f0-9]{48}$/.test(storageName)) throw new PatientFileError('File not found', 404);
  return path.join(storageDir(), storageName);
}

async function readHead(file: string): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Deletes a stored file's bytes (after its row is gone). Never throws. */
export async function removeStoredFile(storageName: string): Promise<void> {
  try {
    await removeQuietly(filePath(storageName));
  } catch {
    // An invalid name was never a stored file.
  }
}

export async function removeQuietly(file: string | undefined): Promise<void> {
  if (file) await fs.promises.unlink(file).catch(() => undefined);
}

export interface FileMeta {
  category: PatientFileCategory;
  /** YYYY-MM-DD — the date the document is from. */
  documentDate: Date;
  note: string | null;
}

export interface Uploader {
  type: Extract<ActorType, 'STAFF' | 'PATIENT'>;
  staffId?: string;
  /** The uploading clinic; null for a patient's own upload. */
  clinicId: string | null;
}

/** Moves an uploaded temp file into storage under a random name and records it. */
async function storeAndRecord(
  tempFile: string,
  patientId: string,
  meta: FileMeta,
  uploader: Uploader,
  mimeType: AllowedMime,
  pageCount: number | null,
): Promise<PatientFile> {
  const storageName = crypto.randomBytes(24).toString('hex');
  const target = filePath(storageName);
  await fs.promises.rename(tempFile, target);
  await fs.promises.chmod(target, 0o600).catch(() => undefined);
  const { size } = await fs.promises.stat(target);
  try {
    const row = await prisma.patientFile.create({
      data: {
        patientId,
        clinicId: uploader.clinicId,
        uploadedByType: uploader.type,
        uploadedByStaffId: uploader.staffId,
        category: meta.category,
        documentDate: meta.documentDate,
        note: meta.note,
        storageName,
        mimeType,
        sizeBytes: size,
        pageCount,
      },
    });
    await recordAuditEvent({
      actorType: uploader.type,
      actorId: uploader.type === 'STAFF' ? uploader.staffId : patientId,
      staffId: uploader.staffId,
      clinicId: uploader.clinicId ?? undefined,
      patientId,
      action: 'PATIENT_FILE_UPLOADED',
      entityType: 'PatientFile',
      entityId: row.id,
      metadata: { category: meta.category, mimeType, sizeBytes: size, pageCount },
    });
    return row;
  } catch (err) {
    await removeQuietly(target);
    throw err;
  }
}

/** One JPG, PNG or PDF (already on disk in the incoming folder, at most 20 MB). */
export async function savePatientFile(tempFile: string, patientId: string, meta: FileMeta, uploader: Uploader): Promise<PatientFile> {
  try {
    const { size } = await fs.promises.stat(tempFile);
    if (size > MAX_FILE_BYTES) throw new PatientFileError('Files can be at most 20 MB', 413);
    if (size === 0) throw new PatientFileError('That file is empty', 400);
    const mime = detectFileType(await readHead(tempFile));
    if (!mime) throw new PatientFileError('Only JPG, PNG and PDF files can be uploaded', 400);
    return await storeAndRecord(tempFile, patientId, meta, uploader, mime, null);
  } catch (err) {
    await removeQuietly(tempFile);
    throw err;
  }
}

/**
 * "Previous records": several photos of a paper file, taken in one go,
 * combined into a single PDF (one photo per page, in the order taken),
 * filed under Previous records.
 */
export async function savePhotosAsPdf(tempFiles: string[], patientId: string, meta: Omit<FileMeta, 'category'>, uploader: Uploader): Promise<PatientFile> {
  const pdfPath = path.join(incomingDir(), `${crypto.randomBytes(16).toString('hex')}.pdf`);
  try {
    if (tempFiles.length === 0) throw new PatientFileError('Take at least one photo', 400);
    if (tempFiles.length > MAX_PHOTOS_PER_PDF) throw new PatientFileError(`At most ${MAX_PHOTOS_PER_PDF} photos at a time`, 400);
    let total = 0;
    for (const [i, f] of tempFiles.entries()) {
      const { size } = await fs.promises.stat(f);
      if (size > MAX_FILE_BYTES) throw new PatientFileError(`Photo ${i + 1} is over 20 MB`, 413);
      total += size;
      const mime = detectFileType(await readHead(f));
      if (mime !== 'image/jpeg' && mime !== 'image/png') throw new PatientFileError(`Photo ${i + 1} is not a JPG or PNG photo`, 400);
    }
    if (total > MAX_PHOTOS_TOTAL_BYTES) throw new PatientFileError('Those photos are over 100 MB together. Save them in two goes.', 413);
    const doc = new PDFDocument({ autoFirstPage: false, info: { Title: 'Previous records', Producer: 'ACISI' } });
    const out = fs.createWriteStream(pdfPath, { mode: 0o600 });
    const finished = new Promise<void>((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      doc.on('error', reject);
    });
    doc.pipe(out);
    try {
      for (const [i, f] of tempFiles.entries()) {
        // One photo in memory at a time; wait for the disk to catch up between pages.
        const img = await fs.promises.readFile(f);
        // openImage exists in pdfkit but is missing from its type definitions.
        let opened: { width: number; height: number };
        try {
          opened = (doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(img);
        } catch {
          throw new PatientFileError(`Photo ${i + 1} couldn't be read. Take it again.`, 400);
        }
        // A4 page in the photo's orientation; the photo fills it with a small margin.
        const portrait = opened.height >= opened.width;
        const [w, h] = portrait ? [595.28, 841.89] : [841.89, 595.28];
        doc.addPage({ size: [w, h], margin: 0 });
        doc.image(opened as unknown as Buffer, 18, 18, { fit: [w - 36, h - 36], align: 'center', valign: 'center' });
        await new Promise<void>((resolve) => (out.writableLength > 4 * 1024 * 1024 ? out.once('drain', () => resolve()) : setImmediate(resolve)));
      }
    } finally {
      doc.end();
    }
    await finished;
    return await storeAndRecord(pdfPath, patientId, { ...meta, category: 'PREVIOUS_RECORDS' }, uploader, 'application/pdf', tempFiles.length);
  } catch (err) {
    await removeQuietly(pdfPath);
    throw err;
  } finally {
    for (const f of tempFiles) await removeQuietly(f);
  }
}

// --- Who can see what ---------------------------------------------------------

export type FileViewer = { kind: 'patient'; patientId: string } | { kind: 'clinic'; clinicId: string; staffId: string };

/**
 * The files a viewer may see for a patient, plus how many are hidden.
 * Same rule as visit records: the patient sees all of their own files; a
 * clinic sees the files it uploaded, and everything else (other clinics'
 * uploads and the patient's own uploads) only with the patient's approval.
 */
export async function listPatientFiles(patientId: string, viewer: FileViewer): Promise<{ files: PatientFile[]; hiddenCount: number }> {
  const all = await prisma.patientFile.findMany({ where: { patientId }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }] });
  if (viewer.kind === 'patient') return { files: all, hiddenCount: 0 };
  const others = all.filter((f) => f.clinicId !== viewer.clinicId);
  const shared = others.length > 0 && (await clinicHasRecordAccess(patientId, viewer.clinicId));
  const files = shared ? all : all.filter((f) => f.clinicId === viewer.clinicId);
  return { files, hiddenCount: all.length - files.length };
}

/** Throws "not found" unless the viewer may open this file — never says it exists otherwise. */
export async function openPatientFile(fileId: string, viewer: FileViewer): Promise<{ file: PatientFile; stream: fs.ReadStream }> {
  const file = await prisma.patientFile.findUnique({ where: { id: fileId } });
  const notFound = new PatientFileError('File not found', 404);
  if (!file) throw notFound;
  if (viewer.kind === 'patient') {
    if (file.patientId !== viewer.patientId) throw notFound;
  } else {
    const known = await prisma.patient.findFirst({
      where: { id: file.patientId, deletedAt: null, ...clinicCanSeePatientWhere(viewer.clinicId) },
      select: { id: true },
    });
    if (!known) throw notFound;
    if (file.clinicId !== viewer.clinicId && !(await clinicHasRecordAccess(file.patientId, viewer.clinicId))) throw notFound;
  }
  const full = filePath(file.storageName);
  try {
    await fs.promises.access(full, fs.constants.R_OK);
  } catch {
    throw notFound;
  }
  await recordAuditEvent({
    actorType: viewer.kind === 'patient' ? 'PATIENT' : 'STAFF',
    actorId: viewer.kind === 'patient' ? viewer.patientId : viewer.staffId,
    staffId: viewer.kind === 'clinic' ? viewer.staffId : undefined,
    clinicId: viewer.kind === 'clinic' ? viewer.clinicId : undefined,
    patientId: file.patientId,
    action: 'PATIENT_FILE_VIEWED',
    entityType: 'PatientFile',
    entityId: file.id,
    metadata: viewer.kind === 'clinic' ? { ownClinicFile: file.clinicId === viewer.clinicId } : undefined,
  });
  return { file, stream: fs.createReadStream(full) };
}

/** A safe download name: "X-ray 2026-03-15.jpg". Never the uploader's original name. */
export function downloadName(file: Pick<PatientFile, 'category' | 'documentDate' | 'mimeType'>): string {
  const ext = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg';
  return `${CATEGORY_LABEL[file.category]} ${file.documentDate.toISOString().slice(0, 10)}.${ext}`;
}

/** The JSON shape every file list uses. */
export function fileView(f: PatientFile, viewerClinicId?: string) {
  return {
    id: f.id,
    category: f.category,
    categoryLabel: CATEGORY_LABEL[f.category],
    documentDate: f.documentDate.toISOString().slice(0, 10),
    note: f.note,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
    patientUploaded: f.uploadedByType === 'PATIENT',
    fromThisClinic: viewerClinicId !== undefined && f.clinicId === viewerClinicId,
    uploadedAt: f.createdAt,
  };
}

// --- Storage usage (owner page) ---------------------------------------------

export async function storageUsage(): Promise<{ filesBytes: number; fileCount: number; disk: { totalBytes: number; freeBytes: number } | null }> {
  const agg = await prisma.patientFile.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } });
  let disk: { totalBytes: number; freeBytes: number } | null = null;
  try {
    await ensureStorageDirs();
    const st = await fs.promises.statfs(storageDir());
    disk = { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    disk = null;
  }
  return { filesBytes: agg._sum.sizeBytes ?? 0, fileCount: agg._count._all, disk };
}
