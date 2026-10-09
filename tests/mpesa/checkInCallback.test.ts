import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/checkInService', () => ({ applyPaymentResult: jest.fn() }));
jest.mock('../../src/services/billingService', () => ({ applyClinicStkResult: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { applyPaymentResult } from '../../src/services/checkInService';
import { logger } from '../../src/utils/logger';
import { mpesaRouter } from '../../src/mpesa/router';

const app = express();
app.use(express.json());
app.use('/api/mpesa', mpesaRouter);

const paid = {
  Body: {
    stkCallback: {
      MerchantRequestID: 'mr-1',
      CheckoutRequestID: 'ws_CO_1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 50 },
          { Name: 'MpesaReceiptNumber', Value: 'QKL98MN76P' },
          { Name: 'PhoneNumber', Value: 254712345678 },
        ],
      },
    },
  },
};

/** Everything the logger was given, as one string, to check nothing sensitive slipped in. */
function everythingLogged(): string {
  return JSON.stringify([...(logger.info as jest.Mock).mock.calls, ...(logger.warn as jest.Mock).mock.calls]);
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/mpesa/callback logging', () => {
  it('logs exactly one line with only the checkInId, resultCode and new status', async () => {
    (applyPaymentResult as jest.Mock).mockResolvedValue({ checkInId: 'ci-1', status: 'PAID' });

    expect((await request(app).post('/api/mpesa/callback').send(paid)).status).toBe(200);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect((logger.info as jest.Mock).mock.calls[0][0]).toEqual({
      checkInId: 'ci-1',
      resultCode: 0,
      status: 'PAID',
    });
    expect(everythingLogged()).not.toMatch(/254712345678|QKL98MN76P|ws_CO_1|mr-1/);
  });

  it('logs a cancellation with its result code', async () => {
    (applyPaymentResult as jest.Mock).mockResolvedValue({ checkInId: 'ci-2', status: 'FAILED' });
    const cancelled = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'mr-2',
          CheckoutRequestID: 'ws_CO_2',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    };

    await request(app).post('/api/mpesa/callback').send(cancelled);

    expect((logger.info as jest.Mock).mock.calls[0][0]).toEqual({
      checkInId: 'ci-2',
      resultCode: 1032,
      status: 'FAILED',
    });
  });

  it('still logs one line for a callback matching no check-in', async () => {
    (applyPaymentResult as jest.Mock).mockResolvedValue(null);

    await request(app).post('/api/mpesa/callback').send(paid);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect((logger.info as jest.Mock).mock.calls[0][0]).toEqual({
      checkInId: null,
      resultCode: 0,
      status: null,
    });
  });

  it('never logs the body of a malformed callback', async () => {
    await request(app).post('/api/mpesa/callback').send({ PhoneNumber: 254712345678 });
    expect(everythingLogged()).not.toContain('254712345678');
  });
});
