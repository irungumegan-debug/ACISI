import { env } from '../config/env';
import { darajaClient, darajaPassword, darajaTimestamp, logDarajaError } from './daraja';
import { StkQueryResponse } from './types';

/**
 * Actively queries Daraja for an STK push's outcome. Used as a fallback when
 * the async callback hasn't arrived within a reasonable window (network
 * issues, dropped callback delivery) — see jobs/workers/stkStatusWorker.ts.
 */
export async function queryStkPushStatus(checkoutRequestId: string): Promise<StkQueryResponse> {
  const timestamp = darajaTimestamp();
  const password = darajaPassword(timestamp);
  const client = await darajaClient();

  try {
    const { data } = await client.post<{
      ResultCode: string;
      ResultDesc: string;
      MerchantRequestID: string;
      CheckoutRequestID: string;
    }>('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    });

    return {
      resultCode: data.ResultCode,
      resultDesc: data.ResultDesc,
      merchantRequestId: data.MerchantRequestID,
      checkoutRequestId: data.CheckoutRequestID,
    };
  } catch (err) {
    logDarajaError('queryStkPushStatus', err);
    throw err;
  }
}
