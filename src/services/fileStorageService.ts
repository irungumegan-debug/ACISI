import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encryptionKey } from '../utils/fieldCrypto';
import PDFDocument from 'pdfkit';
import { ActorType, PatientFile, PatientFileCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { recordAuditEvent } from './auditService';
import { crossClinicAccessBasis } from './recordSharingService';
import { staffPatientScopeWhere, StaffScopeSession } from './staffPatientScope';

/**
 * Patient files (X-rays, scans, lab reports, photos of old paper files).
 *
 * - Bytes live on THIS server's disk, in env.FILE_STORAGE_DIR (mode 0700,
 *   outside the web root), under random names with no extension. Nothing
 *   goes to any cloud service, so patient data stays in Kenya.
 * - Only JPG, PNG and PDF, recognised by their content (magic bytes), not
 *   by the file name. At most 20 MB each.
 * - Served only through logged-in routes that apply the same rule as visit
 *   records: the uploading clinic and the patient always; any other clinic
 *   only on the patient's sharing consent or a "Request records" code used
 *   today (recordSharingService.crossClinicAccessBasis).
 * - Uploads are refused when the disk is nearly full (FILE_UPLOAD_MIN_FREE_MB).
 * - Every upload and every view is in the audit log (IDs only, never notes).
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** "Previous records" photos combined into one PDF in a single go. */
export const MAX_PHOTOS_PER_PDF = 30;
/**
 * And at most this much in total. The server has 1 GB of RAM (the app is
 * capped at 500 MB), so photos are read one at a time while the PDF is
 * written straight to disk, never all held in memory together.
 */
export const MAX_PHOTOS_TOTAL_BYTES = 100 * 1024 * 1024;

export type AllowedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export class PatientFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 413 | 507,
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

/** Recognises a file by its first bytes. Anything else, whatever its name says, is refused. */
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

/** Free and total bytes on the disk that holds the files, or null if it can't be read. */
export async function diskSpace(): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    await ensureStorageDirs();
    const st = await fs.promises.statfs(storageDir());
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    return null;
  }
}

/**
 * Refuses an upload before anything is written when the disk is nearly
 * full. A full disk stops the database and Redis from saving (13 Nov 2026
 * outage), so uploads must never be what fills it.
 */
export async function assertDiskHasRoom(): Promise<void> {
  const disk = await diskSpace();
  if (disk && disk.freeBytes < env.FILE_UPLOAD_MIN_FREE_MB * 1024 * 1024) {
    throw new PatientFileError('The server is low on storage, so files can’t be uploaded right now. Please tell ACISI.', 507);
  }
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
  /** The date the document is from. */
  documentDate: Date;
  note: string | null;
  /** Set when the lab attaches the file to a lab order's results. */
  labOrderId?: string;
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
  // Size of the file itself (what a viewer downloads), before encryption.
  const { size } = await fs.promises.stat(tempFile);
  if (encryptionKey()) {
    await encryptFile(tempFile, target);
    await removeQuietly(tempFile);
  } else {
    await fs.promises.rename(tempFile, target);
  }
  await fs.promises.chmod(target, 0o600).catch(() => undefined);
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
        labOrderId: meta.labOrderId,
      },
    });
    await recordAuditEvent({
      actorType: uploader.type,
      actorId: uploader.type === 'STAFF' ? uploader.staffId : patientId,
      staffId: uploader.staffId,
      clinicId: uploader.clinicId,
      action: 'PATIENT_FILE_UPLOADED',
      entityType: 'PatientFile',
      entityId: row.id,
      metadata: { patientId, category: meta.category, mimeType, sizeBytes: size, pageCount, labOrderId: meta.labOrderId },
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

export type FileViewer = { kind: 'patient'; patientId: string } | ({ kind: 'staff' } & StaffScopeSession);

/** True when this staff member may see this patient at all (same rule as the patient page). */
export async function staffCanSeePatient(patientId: string, viewer: StaffScopeSession): Promise<boolean> {
  const known = await prisma.patient.findFirst({
    where: { AND: [{ id: patientId, deletedAt: null }, await staffPatientScopeWhere(viewer)] },
    select: { id: true },
  });
  return Boolean(known);
}

/**
 * The files a viewer may see for a patient, plus how many are hidden.
 * Same rule as visit records: the patient sees all of their own files; a
 * clinic sees the files it uploaded, and everything else (other clinics'
 * uploads and the patient's own uploads) only on a sharing basis.
 * Callers check staffCanSeePatient first.
 */
export async function listPatientFiles(patientId: string, viewer: FileViewer): Promise<{ files: PatientFile[]; hiddenCount: number }> {
  const all = await prisma.patientFile.findMany({ where: { patientId }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }] });
  if (viewer.kind === 'patient') return { files: all, hiddenCount: 0 };
  const others = all.filter((f) => f.clinicId !== viewer.clinicId);
  const shared = others.length > 0 && (await crossClinicAccessBasis(patientId, viewer.clinicId)) !== null;
  const files = shared ? all : all.filter((f) => f.clinicId === viewer.clinicId);
  return { files, hiddenCount: all.length - files.length };
}

/** Throws "not found" unless the viewer may open this file: never says it exists otherwise. */
export async function openPatientFile(fileId: string, viewer: FileViewer): Promise<{ file: PatientFile; stream: Readable }> {
  const file = await prisma.patientFile.findUnique({ where: { id: fileId } });
  const notFound = new PatientFileError('File not found', 404);
  if (!file) throw notFound;
  let basis: string | null = null;
  if (viewer.kind === 'patient') {
    if (file.patientId !== viewer.patientId) throw notFound;
  } else {
    if (!(await staffCanSeePatient(file.patientId, viewer))) throw notFound;
    if (file.clinicId !== viewer.clinicId) {
      basis = await crossClinicAccessBasis(file.patientId, viewer.clinicId);
      if (!basis) throw notFound;
    }
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
    staffId: viewer.kind === 'staff' ? viewer.staffId : undefined,
    clinicId: viewer.kind === 'staff' ? viewer.clinicId : null,
    action: 'PATIENT_FILE_VIEWED',
    entityType: 'PatientFile',
    entityId: file.id,
    metadata: viewer.kind === 'staff' ? { patientId: file.patientId, ownClinicFile: file.clinicId === viewer.clinicId, basis } : { patientId: file.patientId },
  });
  return { file, stream: await openStoredBytes(full) };
}

/** Opens a stored file's bytes; "not found" if they're missing. Callers decide who may see it and audit the view. */
export async function streamStoredFile(file: PatientFile): Promise<Readable> {
  const full = filePath(file.storageName);
  try {
    await fs.promises.access(full, fs.constants.R_OK);
  } catch {
    throw new PatientFileError('File not found', 404);
  }
  return openStoredBytes(full);
}

// --- Encryption at rest -------------------------------------------------------
// Stored files are AES-256-GCM encrypted with DATA_ENCRYPTION_KEY:
// "ACISIENC1" | 12-byte IV | ciphertext | 16-byte tag. Files stored before
// encryption was switched on have no such header and are served as they are.

const FILE_MAGIC = Buffer.from('ACISIENC1', 'latin1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

async function encryptFile(source: string, target: string): Promise<void> {
  const key = encryptionKey()!;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = fs.createWriteStream(target, { mode: 0o600 });
  out.write(Buffer.concat([FILE_MAGIC, iv]));
  try {
    await pipeline(fs.createReadStream(source), cipher, out, { end: false });
    await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    await removeQuietly(target);
    throw err;
  }
}

/** The stored bytes as the original file: decrypted when encrypted, as-is for older files. */
async function openStoredBytes(full: string): Promise<Readable> {
  const head = await readHead(full);
  if (head.length < FILE_MAGIC.length || !head.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return fs.createReadStream(full);
  const key = encryptionKey();
  if (!key) throw new Error('Encrypted file found but DATA_ENCRYPTION_KEY is not set');
  const { size } = await fs.promises.stat(full);
  const fh = await fs.promises.open(full, 'r');
  const iv = Buffer.alloc(IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await fh.read(iv, 0, IV_BYTES, FILE_MAGIC.length);
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await fh.close();
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const start = FILE_MAGIC.length + IV_BYTES;
  const end = size - TAG_BYTES - 1;
  if (end < start) {
    decipher.end();
    return decipher;
  }
  return fs.createReadStream(full, { start, end }).pipe(decipher);
}

/** Encrypts a file stored before encryption was switched on (scripts/encryptExistingData.ts). Returns false if already encrypted. */
export async function encryptStoredFileInPlace(storageName: string): Promise<boolean> {
  const full = filePath(storageName);
  const head = await readHead(full);
  if (head.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return false;
  const tmp = `${full}.enc-tmp`;
  await encryptFile(full, tmp);
  await fs.promises.rename(tmp, full);
  return true;
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
  return { filesBytes: agg._sum.sizeBytes ?? 0, fileCount: agg._count._all, disk: await diskSpace() };
}
