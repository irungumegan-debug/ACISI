import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/checkInService', () => ({ applyPaymentResult: jest.fn() }));
jest.mock('../../src/services/billingService', () => ({ applyClinicStkResult: jest.fn() }));

import { applyPaymentResult } from '../../src/services/checkInService';
import { applyClinicStkResult } from '../../src/services/billingService';
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
    expect(applyPaymentResult).not.toHaveBeenCalled();
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
    expect(applyPaymentResult).toHaveBeenCalled();
    expect(applyClinicStkResult).not.toHaveBeenCalled();
  });
});
