import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acisi-upload-'));
process.env.FILE_STORAGE_DIR = dir;

const rows: Record<string, unknown>[] = [];
jest.mock('../../src/dashboard/session', () => ({ ...jest.requireActual('../../src/dashboard/session'), loadDashboardSession: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ clinicHasRecordAccess: jest.fn(async () => false) }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findFirst: jest.fn() },
    patientFile: {
      create: jest.fn(async ({ data }) => {
        const row = { id: `f-${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    },
  },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { prisma } from '../../src/db/prisma';
import { filesRouter } from '../../src/dashboard/files';

const SESSION = { staffId: 'staff-1', staffCode: 'X', staffName: 'R', role: 'RECEPTIONIST', clinicId: 'clinic-A', clinicName: 'Sunrise' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function app() {
  const a = express();
  a.use(cookieParser());
  a.use('/files', filesRouter);
  return a;
}
const auth = (r: request.Test) => r.set('Cookie', `${SESSION_COOKIE_NAME}=t`);

beforeEach(() => {
  rows.length = 0;
  (loadDashboardSession as jest.Mock).mockResolvedValue(SESSION);
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ id: 'patient-1' });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

it('uploads a PDF and serves it back privately to the uploading clinic', async () => {
  const up = await auth(request(app()).post('/files/patient/patient-1').field('category', 'LAB_REPORT').field('documentDate', '2026-03-15').attach('file', PDF, 'report.pdf'));
  expect(up.status).toBe(201);
  expect(up.body).toMatchObject({ categoryLabel: 'Lab report', documentDate: '2026-03-15', fromThisClinic: true, patientUploaded: false });

  const get = await auth(request(app()).get(`/files/${up.body.id}`));
  expect(get.status).toBe(200);
  expect(get.headers['content-type']).toBe('application/pdf');
  expect(get.headers['cache-control']).toBe('private, no-store');
  expect(get.headers['x-content-type-options']).toBe('nosniff');
  expect(get.headers['content-disposition']).toBe('inline; filename="Lab report 2026-03-15.pdf"');
});

it('refuses a file whose content is not JPG/PNG/PDF, whatever its name, and leaves nothing behind', async () => {
  const res = await auth(
    request(app()).post('/files/patient/patient-1').field('category', 'XRAY').field('documentDate', '2026-03-15').attach('file', Buffer.from('<script>alert(1)</script>'), 'xray.jpg'),
  );
  expect(res.status).toBe(400);
  expect(fs.readdirSync(path.join(dir, '.incoming'))).toEqual([]);
  expect(rows).toHaveLength(0);
});

it('needs a category and a real date', async () => {
  expect((await auth(request(app()).post('/files/patient/patient-1').field('documentDate', '2026-03-15').attach('file', PDF, 'a.pdf'))).status).toBe(400);
  expect((await auth(request(app()).post('/files/patient/patient-1').field('category', 'XRAY').field('documentDate', '2999-01-01').attach('file', PDF, 'a.pdf'))).status).toBe(400);
});

it("can't upload to a patient the clinic doesn't know", async () => {
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue(null);
  const res = await auth(request(app()).post('/files/patient/patient-9').field('category', 'XRAY').field('documentDate', '2026-03-15').attach('file', PDF, 'a.pdf'));
  expect(res.status).toBe(404);
});

it("another clinic can't open the file without the patient's approval", async () => {
  const up = await auth(request(app()).post('/files/patient/patient-1').field('category', 'XRAY').field('documentDate', '2026-03-15').attach('file', PDF, 'a.pdf'));
  (loadDashboardSession as jest.Mock).mockResolvedValue({ ...SESSION, clinicId: 'clinic-B', staffId: 'staff-9' });
  expect((await auth(request(app()).get(`/files/${up.body.id}`))).status).toBe(404);
});

it('requires a staff session', async () => {
  (loadDashboardSession as jest.Mock).mockResolvedValue(null);
  expect((await auth(request(app()).get('/files/f-1'))).status).toBe(401);
});
