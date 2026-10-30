/** The sandbox-only clinic checkout prompt can never run on a live (MPESA_ENV=production) server. */
const post = jest.fn();
const get = jest.fn();
jest.mock('axios', () => ({ ...jest.requireActual('axios'), post, get }));
jest.mock('../../src/config/redis', () => ({ redis: { get: jest.fn(async () => null), set: jest.fn() } }));

import { env } from '../../src/config/env';
import {
  ClinicStkDisabledError,
  clinicStkConfigured,
  queryClinicStkStatus,
  sendClinicStkPush,
} from '../../src/mpesa/clinicStk';

const mutableEnv = env as { -readonly [K in keyof typeof env]: (typeof env)[K] };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mutableEnv, {
    MPESA_ENV: 'sandbox',
    CLINIC_DARAJA_CONSUMER_KEY: 'k',
    CLINIC_DARAJA_CONSUMER_SECRET: 's',
    CLINIC_DARAJA_PASSKEY: 'p',
    CLINIC_MPESA_CALLBACK_URL: 'https://acisi.co.ke/api/mpesa/clinic-callback',
  });
});

describe('clinic checkout M-Pesa on a live server', () => {
  it('is available in sandbox when its keys are set', () => {
    expect(clinicStkConfigured()).toBe(true);
  });

  it('is switched off when MPESA_ENV=production, even with its keys set', async () => {
    mutableEnv.MPESA_ENV = 'production';
    expect(clinicStkConfigured()).toBe(false);
    await expect(
      sendClinicStkPush({
        amountKes: 100,
        phoneNumberE164: '+254712345678',
        accountReference: 'r',
        transactionDesc: 'd',
        mobileMoneyType: 'TILL',
      }),
    ).rejects.toBeInstanceOf(ClinicStkDisabledError);
    await expect(queryClinicStkStatus('ws_CO_1')).rejects.toBeInstanceOf(ClinicStkDisabledError);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('CLINIC_MPESA_ENV itself only accepts sandbox', () => {
    expect(env.CLINIC_MPESA_ENV).toBe('sandbox');
  });
});
