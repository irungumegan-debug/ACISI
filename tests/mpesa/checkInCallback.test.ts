import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/checkInService', () => ({ applyPaymentResult: jest.fn() }));
jest.mock('../../src/services/billingService', () => ({ applyClinicStkResult: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  ...jest.requireActual('../../src/utils/logger'),
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

describe('POST /api/mpesa/callback', () => {
  it("hands the callback to applyPaymentResult as source 'callback' (which writes the one log line) and logs nothing itself", async () => {
    (applyPaymentResult as jest.Mock).mockResolvedValue({ checkInId: 'ci-1', status: 'PAID' });

    expect((await request(app).post('/api/mpesa/callback').send(paid)).status).toBe(200);

    expect(applyPaymentResult).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutRequestId: 'ws_CO_1', resultCode: 0 }),
      paid,
      'callback',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('still answers 200 when processing fails, logging only the error name and result code', async () => {
    const err = Object.assign(new Error('Unique constraint failed: 254712345678 QKL98MN76P'), {
      code: 'P2002',
    });
    (applyPaymentResult as jest.Mock).mockRejectedValue(err);

    expect((await request(app).post('/api/mpesa/callback').send(paid)).status).toBe(200);

    expect((logger.error as jest.Mock).mock.calls[0][0]).toEqual({
      err: { name: 'Error', code: 'P2002' },
      resultCode: 0,
    });
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toMatch(/254712345678|QKL98MN76P/);
  });

  it('never logs the body of a malformed callback', async () => {
    await request(app).post('/api/mpesa/callback').send({ PhoneNumber: 254712345678 });
    expect(everythingLogged()).not.toContain('254712345678');
  });
});
