import { env } from '../config/env';
import { toDarajaFormat } from '../utils/phone';
import { darajaClient, darajaPassword, darajaTimestamp, logDarajaError } from './daraja';
import { StkPushRequest, StkPushResponse } from './types';

/**
 * Triggers an M-Pesa STK push (Lipa Na M-Pesa Online) prompt on the
 * patient's phone. Returns Daraja's CheckoutRequestID/MerchantRequestID —
 * the *actual* payment result arrives later via the callback route, not here.
 */
export async function initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
  const timestamp = darajaTimestamp();
  const password = darajaPassword(timestamp);
  const phone = toDarajaFormat(request.phoneNumberE164);

  const client = await darajaClient();

  try {
    const { data } = await client.post<{
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string;
      ResponseDescription: string;
      CustomerMessage: string;
    }>('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(request.amountKes),
      PartyA: phone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: env.MPESA_CALLBACK_URL,
      AccountReference: request.accountReference,
      TransactionDesc: request.transactionDesc,
    });

    return {
      merchantRequestId: data.MerchantRequestID,
      checkoutRequestId: data.CheckoutRequestID,
      responseCode: data.ResponseCode,
      responseDescription: data.ResponseDescription,
      customerMessage: data.CustomerMessage,
    };
  } catch (err) {
    logDarajaError('initiateStkPush', err);
    throw err;
  }
}
