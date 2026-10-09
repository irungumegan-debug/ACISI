/**
 * The demo-clinic safety rules: who counts as a demo recipient (decided by
 * the database alone, never by the number), SMS and M-Pesa refusing them,
 * the demo check-in fee, demo clinics hidden from public lists, and the
 * owner site's totals leaving demo data out.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findFirst: jest.fn(), count: jest.fn() },
    staff: { findFirst: jest.fn(), count: jest.fn() },
    clinic: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    encounter: { count: jest.fn() },
    appointment: { count: jest.fn() },
    checkIn: { aggregate: jest.fn() },
  },
}));
jest.mock('../../src/config/africastalking', () => ({ rawSmsClient: { send: jest.fn() } }));
jest.mock('../../src/mpesa/daraja', () => ({
  darajaClient: jest.fn(),
  darajaPassword: jest.fn(),
  darajaTimestamp: jest.fn(),
  logDarajaError: jest.fn(),
}));

import { prisma } from '../../src/db/prisma';
import { rawSmsClient } from '../../src/config/africastalking';
import { darajaClient } from '../../src/mpesa/daraja';
import { DemoRecipientError, isDemoRecipient } from '../../src/services/demoGuard';
import { sendSms } from '../../src/services/smsService';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import { checkInFeeKes } from '../../src/services/checkInService';
import { findDemoClinicByKey, listActiveClinics } from '../../src/services/clinicService';
import { clinicsRouter } from '../../src/clinics/router';
import { ownerOverviewRouter } from '../../src/owner/overview';
import { env } from '../../src/config/env';

const mockPatientFindFirst = prisma.patient.findFirst as jest.Mock;
const mockStaffFindFirst = prisma.staff.findFirst as jest.Mock;
const mockSend = rawSmsClient.send as jest.Mock;

const DEMO_RANGE_NUMBER = '+254799000150';
const REAL_NUMBER = '+254712345678';

beforeEach(() => {
  jest.clearAllMocks();
  mockPatientFindFirst.mockResolvedValue(null);
  mockStaffFindFirst.mockResolvedValue(null);
});

describe('who is a demo recipient', () => {
  it('is decided by the database: a patient with demoClinicId set, or staff of a demo clinic', async () => {
    await isDemoRecipient(REAL_NUMBER);
    expect(mockPatientFindFirst.mock.calls[0][0].where).toEqual({
      phoneNumber: REAL_NUMBER,
      demoClinicId: { not: null },
    });
    expect(mockStaffFindFirst.mock.calls[0][0].where).toEqual({
      phoneNumber: REAL_NUMBER,
      clinic: { isDemo: true },
    });
  });

  it("never because of the number: a real account in the seed's +254799000 range is not a demo recipient", async () => {
    await expect(isDemoRecipient(DEMO_RANGE_NUMBER)).resolves.toBe(false);
  });

  it('is true for a fake demo patient or demo staff member', async () => {
    mockPatientFindFirst.mockResolvedValueOnce({ id: 'p-fake' });
    await expect(isDemoRecipient(DEMO_RANGE_NUMBER)).resolves.toBe(true);
    mockStaffFindFirst.mockResolvedValueOnce({ id: 's-fake' });
    await expect(isDemoRecipient(DEMO_RANGE_NUMBER)).resolves.toBe(true);
  });
});

describe('SMS', () => {
  it('never reaches a demo patient', async () => {
    mockPatientFindFirst.mockResolvedValue({ id: 'p-fake' });
    await expect(sendSms({ to: DEMO_RANGE_NUMBER, message: 'hi' })).resolves.toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('reaches a real patient — including one checking in at a demo clinic, like the presenter', async () => {
    mockSend.mockResolvedValue({ ok: true });
    await expect(sendSms({ to: REAL_NUMBER, message: 'ACISI: Check-in confirmed' })).resolves.toEqual({
      ok: true,
    });
    expect(mockSend).toHaveBeenCalledWith({ to: [REAL_NUMBER], message: 'ACISI: Check-in confirmed' });
  });

  it('reaches a real account even if its number is in the demo range', async () => {
    await sendSms({ to: DEMO_RANGE_NUMBER, message: 'hi' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('M-Pesa prompts', () => {
  const request = {
    amountKes: 150,
    phoneNumberE164: DEMO_RANGE_NUMBER,
    accountReference: 'x',
    transactionDesc: 'x',
  };

  it('are refused for a demo patient, before Daraja is even contacted', async () => {
    mockPatientFindFirst.mockResolvedValue({ id: 'p-fake' });
    await expect(initiateStkPush(request)).rejects.toBeInstanceOf(DemoRecipientError);
    expect(darajaClient).not.toHaveBeenCalled();
  });

  it('go ahead for a real patient', async () => {
    const post = jest.fn().mockResolvedValue({ data: { CheckoutRequestID: 'c', MerchantRequestID: 'm' } });
    (darajaClient as jest.Mock).mockResolvedValue({ post });
    await initiateStkPush({ ...request, phoneNumberE164: REAL_NUMBER });
    expect(post).toHaveBeenCalled();
  });
});

describe('check-in fee', () => {
  it('is KSh 150 at a demo clinic', async () => {
    (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ isDemo: true });
    await expect(checkInFeeKes('demo')).resolves.toBe(150);
  });

  it('is the normal fee at a real clinic', async () => {
    (prisma.clinic.findUnique as jest.Mock).mockResolvedValue({ isDemo: false });
    await expect(checkInFeeKes('real')).resolves.toBe(env.CHECKIN_FEE_AMOUNT_KES);
  });
});

describe('public clinic list', () => {
  const app = express().use('/clinics', clinicsRouter);

  it('never lists demo clinics (portal and USSD)', async () => {
    (prisma.clinic.findMany as jest.Mock).mockResolvedValue([]);
    await listActiveClinics();
    expect((prisma.clinic.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      isActive: true,
      isDemo: false,
    });
  });

  it('adds the demo clinic, first, only through its demo link', async () => {
    (prisma.clinic.findMany as jest.Mock).mockResolvedValue([{ id: 'real', name: 'Real Clinic' }]);
    (prisma.clinic.findFirst as jest.Mock).mockResolvedValue({
      id: 'demo',
      name: 'Westlands Medical Centre (Demo)',
    });

    const plain = await request(app).get('/clinics');
    const linked = await request(app).get('/clinics?demo=westlands');

    expect(plain.body.clinics.map((c: { id: string }) => c.id)).toEqual(['real']);
    expect(linked.body.clinics.map((c: { id: string }) => c.id)).toEqual(['demo', 'real']);
    expect((prisma.clinic.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      demoKey: 'westlands',
      isDemo: true,
      isActive: true,
    });
  });

  it('finds only demo clinics by key', async () => {
    await findDemoClinicByKey('alina');
    expect((prisma.clinic.findFirst as jest.Mock).mock.calls[0][0].where).toMatchObject({ isDemo: true });
  });
});

describe('owner overview totals', () => {
  it('leave out demo clinics, their staff, visits, appointments and revenue, and their fake patients', async () => {
    for (const m of [
      prisma.clinic.count,
      prisma.staff.count,
      prisma.patient.count,
      prisma.encounter.count,
      prisma.appointment.count,
    ]) {
      (m as jest.Mock).mockResolvedValue(0);
    }
    (prisma.checkIn.aggregate as jest.Mock).mockResolvedValue({ _sum: { amountKes: null } });

    const res = await request(express().use('/overview', ownerOverviewRouter)).get('/overview');

    expect(res.status).toBe(200);
    const wheres = (m: unknown) => (m as jest.Mock).mock.calls.map((c) => c[0]?.where);
    for (const w of wheres(prisma.clinic.count)) expect(w).toMatchObject({ isDemo: false });
    for (const w of wheres(prisma.patient.count)) expect(w).toMatchObject({ demoClinicId: null });
    for (const m of [
      prisma.staff.count,
      prisma.encounter.count,
      prisma.appointment.count,
      prisma.checkIn.aggregate,
    ]) {
      for (const w of wheres(m)) expect(w).toMatchObject({ clinic: { isDemo: false } });
    }
  });
});
