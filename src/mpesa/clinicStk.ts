import axios from 'axios';
import { MobileMoneyType } from '@prisma/client';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { toDarajaFormat } from '../utils/phone';
import { darajaTimestamp, logDarajaError } from './daraja';
import { DemoRecipientError, isDemoRecipient } from '../services/demoGuard';

/**
 * STK push for CLINIC checkout payments — money goes to the clinic, never to
 * ACISI. Deliberately separate from stkPush.ts/daraja.ts (ACISI's own
 * check-in fee): its own Daraja app credentials (CLINIC_DARAJA_*), its own
 * token cache and its own callback URL, so the two can never be mixed up.
 *
 * SANDBOX ONLY for now (env.CLINIC_MPESA_ENV is restricted to 'sandbox').
 * Safaricom's sandbox only accepts its own test shortcode, so every prompt
 * goes to CLINIC_DARAJA_SHORTCODE (174379) while the clinic's real
 * till/paybill is stored and shown. Going live needs each clinic's own
 * production credentials (or a provider) — see "Planned features" in CLAUDE.md.
 */
const CLINIC_SANDBOX_BASE_URL = 'https://sandbox.safaricom.co.ke';
const TOKEN_CACHE_KEY = 'mpesa:clinic:access_token';

export function clinicStkConfigured(): boolean {
  return Boolean(
    env.CLINIC_DARAJA_CONSUMER_KEY && env.CLINIC_DARAJA_CONSUMER_SECRET && env.CLINIC_DARAJA_PASSKEY && env.CLINIC_MPESA_CALLBACK_URL,
  );
}

async function getClinicAccessToken(): Promise<string> {
  const cached = await redis.get(TOKEN_CACHE_KEY);
  if (cached) return cached;
  const credentials = Buffer.from(`${env.CLINIC_DARAJA_CONSUMER_KEY}:${env.CLINIC_DARAJA_CONSUMER_SECRET}`).toString('base64');
  const { data } = await axios.get<{ access_token: string; expires_in: string }>(
    `${CLINIC_SANDBOX_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } },
  );
  await redis.set(TOKEN_CACHE_KEY, data.access_token, 'EX', Math.max(Number(data.expires_in) - 60, 60));
  return data.access_token;
}

function password(timestamp: string): string {
  return Buffer.from(`${env.CLINIC_DARAJA_SHORTCODE}${env.CLINIC_DARAJA_PASSKEY}${timestamp}`).toString('base64');
}

/**
 * Till -> Buy Goods, Paybill -> Pay Bill. In sandbox the test shortcode is a
 * paybill, so every request is sent as Pay Bill regardless; the mapping
 * applies once live per-clinic credentials exist.
 */
export function transactionTypeFor(type: MobileMoneyType | null): 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline' {
  if (env.CLINIC_MPESA_ENV === 'sandbox') return 'CustomerPayBillOnline';
  return type === 'TILL' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
}

export interface ClinicStkRequest {
  amountKes: number;
  phoneNumberE164: string;
  /** Daraja caps this at 12 characters. */
  accountReference: string;
  transactionDesc: string;
  mobileMoneyType: MobileMoneyType | null;
}

export async function sendClinicStkPush(request: ClinicStkRequest): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  // Never prompt a demo clinic's fake patients (see demoGuard.ts).
  if (await isDemoRecipient(request.phoneNumberE164)) throw new DemoRecipientError();
  const timestamp = darajaTimestamp();
  const phone = toDarajaFormat(request.phoneNumberE164);
  const token = await getClinicAccessToken();
  try {
    const { data } = await axios.post<{ MerchantRequestID: string; CheckoutRequestID: string }>(
      `${CLINIC_SANDBOX_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: env.CLINIC_DARAJA_SHORTCODE,
        Password: password(timestamp),
        Timestamp: timestamp,
        TransactionType: transactionTypeFor(request.mobileMoneyType),
        Amount: request.amountKes,
        PartyA: phone,
        PartyB: env.CLINIC_DARAJA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: env.CLINIC_MPESA_CALLBACK_URL,
        AccountReference: request.accountReference.slice(0, 12),
        TransactionDesc: request.transactionDesc.slice(0, 13),
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return { checkoutRequestId: data.CheckoutRequestID, merchantRequestId: data.MerchantRequestID };
  } catch (err) {
    logDarajaError('sendClinicStkPush', err);
    throw err;
  }
}

/** Asks Daraja for a clinic STK push's outcome — the fallback when the callback never arrives. */
export async function queryClinicStkStatus(checkoutRequestId: string): Promise<{ resultCode: string; resultDesc: string }> {
  const timestamp = darajaTimestamp();
  const token = await getClinicAccessToken();
  try {
    const { data } = await axios.post<{ ResultCode: string; ResultDesc: string }>(
      `${CLINIC_SANDBOX_BASE_URL}/mpesa/stkpushquery/v1/query`,
      { BusinessShortCode: env.CLINIC_DARAJA_SHORTCODE, Password: password(timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return { resultCode: String(data.ResultCode), resultDesc: data.ResultDesc };
  } catch (err) {
    logDarajaError('queryClinicStkStatus', err);
    throw err;
  }
}
