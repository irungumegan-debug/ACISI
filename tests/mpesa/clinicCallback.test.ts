import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/checkInService', () => ({ handleStkCallback: jest.fn() }));
jest.mock('../../src/services/billingService', () => ({ applyClinicStkResult: jest.fn() }));
jest.mock('../../src/mpesa/clinicStk', () => ({ clinicStkConfigured: jest.fn(() => true) }));

import { handleStkCallback } from '../../src/services/checkInService';
import { applyClinicStkResult } from '../../src/services/billingService';
import { clinicStkConfigured } from '../../src/mpesa/clinicStk';
import { mpesaRouter } from '../../src/mpesa/router';

const app = express();
app.use(express.json());
app.use('/api/mpesa', mpesaRouter);

const success = {
  Body: {
    stkCallback: {
      MerchantRequestID: 'mr-1',
      CheckoutRequestID: 'ws_CO_1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'QKL98MN76P' }] },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (applyClinicStkResult as jest.Mock).mockResolvedValue(true);
});

describe('POST /api/mpesa/clinic-callback', () => {
  it('applies the result to the clinic payment, never to the ACISI check-in fee', async () => {
    const res = await request(app).post('/api/mpesa/clinic-callback').send(success);
    expect(res.status).toBe(200);
    expect(applyClinicStkResult).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutRequestId: 'ws_CO_1', resultCode: 0, mpesaReceiptNumber: 'QKL98MN76P' }),
    );
    expect(handleStkCallback).not.toHaveBeenCalled();
  });

  it('passes on a cancellation', async () => {
    const cancelled = { Body: { stkCallback: { MerchantRequestID: 'mr-1', CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } };
    await request(app).post('/api/mpesa/clinic-callback').send(cancelled);
    expect(applyClinicStkResult).toHaveBeenCalledWith(expect.objectContaining({ checkoutRequestId: 'ws_CO_2', resultCode: 1032 }));
  });

  it('acknowledges with 200 even if processing fails, so Daraja does not retry forever', async () => {
    (applyClinicStkResult as jest.Mock).mockRejectedValue(new Error('db down'));
    expect((await request(app).post('/api/mpesa/clinic-callback').send(success)).status).toBe(200);
  });

  it('rejects a malformed body', async () => {
    expect((await request(app).post('/api/mpesa/clinic-callback').send({ nope: true })).status).toBe(400);
  });

  it('leaves the ACISI fee callback on its own route', async () => {
    await request(app).post('/api/mpesa/callback').send(success);
    expect(handleStkCallback).toHaveBeenCalled();
    expect(applyClinicStkResult).not.toHaveBeenCalled();
  });
});

describe('clinic callback while clinic M-Pesa requests are switched off (always on a live server)', () => {
  it('is acknowledged but changes nothing', async () => {
    (clinicStkConfigured as jest.Mock).mockReturnValueOnce(false);
    const res = await request(app).post('/api/mpesa/clinic-callback').send(success);
    expect(res.status).toBe(200);
    expect(applyClinicStkResult).not.toHaveBeenCalled();
  });
});
