/**
 * Patient files: type checked by content (not name), private random names
 * on our own disk, photos combined into one PDF, and the access rule —
 * a clinic sees its own uploads, others only with the patient's approval.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acisi-files-'));
process.env.FILE_STORAGE_DIR = dir;

const rows: Record<string, unknown>[] = [];
const audit: Record<string, unknown>[] = [];
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn(async (e: Record<string, unknown>) => audit.push(e)) }));
jest.mock('../../src/services/patientService', () => ({ clinicHasRecordAccess: jest.fn(async () => false) }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patientFile: {
      create: jest.fn(async ({ data }) => {
        const row = { id: `f-${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }) => rows.filter((r) => r.patientId === where.patientId)),
      findUnique: jest.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
      aggregate: jest.fn(async () => ({ _sum: { sizeBytes: rows.reduce((n, r) => n + (r.sizeBytes as number), 0) }, _count: { _all: rows.length } })),
    },
    patient: { findFirst: jest.fn(async () => ({ id: 'patient-1' })) },
  },
}));

import { clinicHasRecordAccess } from '../../src/services/patientService';
import {
  detectFileType,
  ensureStorageDirs,
  incomingDir,
  listPatientFiles,
  openPatientFile,
  savePatientFile,
  savePhotosAsPdf,
  storageUsage,
} from '../../src/services/fileStorageService';

/** A real w×h RGB PNG. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function incoming(content: Buffer): Promise<string> {
  await ensureStorageDirs();
  const p = path.join(incomingDir(), Math.random().toString(16).slice(2));
  await fs.promises.writeFile(p, content);
  return p;
}

/** Reads the served file to the end (so nothing is left open when the temp folder is removed). */
async function drain(stream: NodeJS.ReadableStream): Promise<number> {
  let n = 0;
  for await (const chunk of stream) n += (chunk as Buffer).length;
  return n;
}

const META = { category: 'XRAY' as const, documentDate: new Date('2026-03-15T00:00:00Z'), note: null };
const CLINIC_A = { type: 'STAFF' as const, staffId: 'staff-A', clinicId: 'clinic-A' };

beforeEach(() => {
  rows.length = 0;
  audit.length = 0;
  (clinicHasRecordAccess as jest.Mock).mockResolvedValue(false);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('file type is checked by content, not name', () => {
  it.each([
    ['JPG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg'],
    ['PNG', png(1, 1), 'image/png'],
    ['PDF', Buffer.from('%PDF-1.7\n'), 'application/pdf'],
    ['HTML', Buffer.from('<html><script>alert(1)</script>'), null],
    ['EXE', Buffer.from('MZ\x90\x00'), null],
    ['GIF', Buffer.from('GIF89a'), null],
  ])('%s', (_l, bytes, expected) => {
    expect(detectFileType(bytes)).toBe(expected);
  });

  it('refuses a web page renamed to x-ray.jpg, and deletes it', async () => {
    const tmp = await incoming(Buffer.from('<html><script>alert(1)</script></html>'));
    await expect(savePatientFile(tmp, 'patient-1', META, CLINIC_A)).rejects.toMatchObject({ status: 400 });
    expect(fs.existsSync(tmp)).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it('refuses anything over 20 MB', async () => {
    const tmp = await incoming(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024 * 1024)]));
    await expect(savePatientFile(tmp, 'patient-1', META, CLINIC_A)).rejects.toMatchObject({ status: 413 });
  });
});

describe('storage', () => {
  it('keeps files in the private folder under random names, readable only by the app', async () => {
    const row = await savePatientFile(await incoming(png(4, 4)), 'patient-1', META, CLINIC_A);
    expect(row.storageName).toMatch(/^[a-f0-9]{48}$/);
    const stored = path.join(dir, row.storageName as string);
    expect(fs.existsSync(stored)).toBe(true);
    expect(fs.statSync(stored).mode & 0o077).toBe(0);
    expect(fs.statSync(dir).mode & 0o077).toBe(0);
    expect(row).toMatchObject({ mimeType: 'image/png', clinicId: 'clinic-A', uploadedByType: 'STAFF' });
    expect(audit[0]).toMatchObject({ action: 'PATIENT_FILE_UPLOADED', clinicId: 'clinic-A', patientId: 'patient-1' });
  });

  it('combines several photos of a paper file into one PDF under Previous records', async () => {
    const photos = [await incoming(png(30, 40)), await incoming(png(40, 30)), await incoming(png(20, 20))];
    const row = await savePhotosAsPdf(photos, 'patient-1', { documentDate: META.documentDate, note: 'Old card' }, CLINIC_A);
    expect(row).toMatchObject({ category: 'PREVIOUS_RECORDS', mimeType: 'application/pdf', pageCount: 3, note: 'Old card' });
    const pdf = fs.readFileSync(path.join(dir, row.storageName as string), 'latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3);
    for (const p of photos) expect(fs.existsSync(p)).toBe(false);
  });

  it('refuses a "photo" that is not a JPG or PNG', async () => {
    const photos = [await incoming(png(5, 5)), await incoming(Buffer.from('%PDF-1.7'))];
    await expect(savePhotosAsPdf(photos, 'patient-1', { documentDate: META.documentDate, note: null }, CLINIC_A)).rejects.toThrow(/Photo 2/);
    expect(rows).toHaveLength(0);
  });

  it('reports storage used and free disk space', async () => {
    await savePatientFile(await incoming(png(4, 4)), 'patient-1', META, CLINIC_A);
    const u = await storageUsage();
    expect(u.fileCount).toBe(1);
    expect(u.filesBytes).toBeGreaterThan(0);
    expect(u.disk?.totalBytes).toBeGreaterThan(0);
  });
});

describe('who can see a file', () => {
  async function seed() {
    const mine = await savePatientFile(await incoming(png(2, 2)), 'patient-1', META, CLINIC_A);
    const other = await savePatientFile(await incoming(png(2, 2)), 'patient-1', META, { type: 'STAFF', staffId: 'staff-B', clinicId: 'clinic-B' });
    const own = await savePatientFile(await incoming(png(2, 2)), 'patient-1', META, { type: 'PATIENT', clinicId: null });
    return { mine, other, own };
  }

  it('a clinic sees its own uploads; other clinics’ and the patient’s are hidden without approval', async () => {
    const { mine, other, own } = await seed();
    const view = await listPatientFiles('patient-1', { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' });
    expect(view.files.map((f) => f.id)).toEqual([mine.id]);
    expect(view.hiddenCount).toBe(2);
    await expect(openPatientFile(other.id, { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' })).rejects.toMatchObject({ status: 404 });
    await expect(openPatientFile(own.id, { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' })).rejects.toMatchObject({ status: 404 });
    const { stream } = await openPatientFile(mine.id, { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' });
    await drain(stream);
  });

  it('with the patient’s approval, the clinic sees everything', async () => {
    const { other } = await seed();
    (clinicHasRecordAccess as jest.Mock).mockResolvedValue(true);
    expect((await listPatientFiles('patient-1', { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' })).files).toHaveLength(3);
    const { stream } = await openPatientFile(other.id, { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' });
    await drain(stream);
  });

  it('the patient sees all of their files, and nobody else’s', async () => {
    const { other } = await seed();
    expect((await listPatientFiles('patient-1', { kind: 'patient', patientId: 'patient-1' })).files).toHaveLength(3);
    await expect(openPatientFile(other.id, { kind: 'patient', patientId: 'patient-2' })).rejects.toMatchObject({ status: 404 });
  });

  it('every view is audited', async () => {
    const { mine } = await seed();
    audit.length = 0;
    const { stream } = await openPatientFile(mine.id, { kind: 'clinic', clinicId: 'clinic-A', staffId: 'staff-A' });
    await drain(stream);
    expect(audit).toEqual([expect.objectContaining({ action: 'PATIENT_FILE_VIEWED', clinicId: 'clinic-A', patientId: 'patient-1', staffId: 'staff-A' })]);
  });
});
