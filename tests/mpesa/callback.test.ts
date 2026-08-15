import { parseStkCallback } from '../../src/mpesa/callback';
import { StkCallbackPayload } from '../../src/mpesa/types';

describe('parseStkCallback', () => {
  it('parses a successful callback with metadata', () => {
    const payload: StkCallbackPayload = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-1',
          CheckoutRequestID: 'checkout-1',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 100 },
              { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
              { Name: 'TransactionDate', Value: 20240115143022 },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    };

    const parsed = parseStkCallback(payload);

    expect(parsed.resultCode).toBe(0);
    expect(parsed.amountKes).toBe(100);
    expect(parsed.mpesaReceiptNumber).toBe('NLJ7RT61SV');
    expect(parsed.phoneNumber).toBe('254712345678');
    expect(parsed.transactionDate).toEqual(new Date(2024, 0, 15, 14, 30, 22));
  });

  it('parses a failed callback with no metadata', () => {
    const payload: StkCallbackPayload = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-2',
          CheckoutRequestID: 'checkout-2',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user.',
        },
      },
    };

    const parsed = parseStkCallback(payload);

    expect(parsed.resultCode).toBe(1032);
    expect(parsed.mpesaReceiptNumber).toBeUndefined();
    expect(parsed.amountKes).toBeUndefined();
  });
});
