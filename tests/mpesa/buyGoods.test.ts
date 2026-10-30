/**
 * Buy Goods till (MPESA_TILL_NUMBER): the store number goes in
 * BusinessShortCode, the password and the status query; the till in PartyB.
 * Without a till, prompts stay Paybill exactly as before.
 */
const post = jest.fn();
jest.mock('../../src/config/redis', () => ({ redis: { get: jest.fn(async () => 'token'), set: jest.fn() } }));
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, create: jest.fn(() => ({ post })), isAxiosError: actual.isAxiosError };
});

const STORE = '7654321';
const TILL = '5123456';
const TIMESTAMP_PATTERN = /^\d{14}$/;

function loadWith(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  let mods!: {
    stk: typeof import('../../src/mpesa/stkPush');
    verify: typeof import('../../src/mpesa/verify');
  };
  jest.isolateModules(() => {
    // isolateModules needs require(): env.ts reads process.env once, at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mods = { stk: require('../../src/mpesa/stkPush'), verify: require('../../src/mpesa/verify') };
  });
  process.env = saved;
  return mods;
}

const decode = (password: string) => Buffer.from(password, 'base64').toString();
const STK_REQUEST = {
  amountKes: 50,
  phoneNumberE164: '+254712345678',
  accountReference: 'ref',
  transactionDesc: 'Check-in fee',
};

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({
    data: {
      MerchantRequestID: 'mr',
      CheckoutRequestID: 'ws_CO_1',
      ResponseCode: '0',
      ResultCode: '0',
      ResultDesc: 'ok',
    },
  });
});

describe('M-Pesa Buy Goods till', () => {
  it('with MPESA_TILL_NUMBER: CustomerBuyGoodsOnline, store number in BusinessShortCode and password, till in PartyB', async () => {
    const { stk, verify } = loadWith({
      MPESA_SHORTCODE: STORE,
      MPESA_TILL_NUMBER: TILL,
      MPESA_PASSKEY: 'live-passkey',
    });
    await stk.initiateStkPush(STK_REQUEST);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/mpesa/stkpush/v1/processrequest');
    expect(body).toMatchObject({
      TransactionType: 'CustomerBuyGoodsOnline',
      BusinessShortCode: STORE,
      PartyB: TILL,
      PartyA: '254712345678',
      Amount: 50,
    });
    expect(body.Timestamp).toMatch(TIMESTAMP_PATTERN);
    expect(decode(body.Password)).toBe(`${STORE}live-passkey${body.Timestamp}`);

    await verify.queryStkPushStatus('ws_CO_1');
    const [queryPath, query] = post.mock.calls[1];
    expect(queryPath).toBe('/mpesa/stkpushquery/v1/query');
    expect(query.BusinessShortCode).toBe(STORE);
    expect(decode(query.Password)).toBe(`${STORE}live-passkey${query.Timestamp}`);
    expect(JSON.stringify(query)).not.toContain(TILL);
  });

  it('without a till: Paybill exactly as before (the paybill in both BusinessShortCode and PartyB)', async () => {
    const { stk } = loadWith({ MPESA_SHORTCODE: '600100', MPESA_TILL_NUMBER: undefined });
    await stk.initiateStkPush(STK_REQUEST);
    expect(post.mock.calls[0][1]).toMatchObject({
      TransactionType: 'CustomerPayBillOnline',
      BusinessShortCode: '600100',
      PartyB: '600100',
    });
  });

  it('an empty MPESA_TILL_NUMBER counts as not set', async () => {
    const { stk } = loadWith({ MPESA_SHORTCODE: '600100', MPESA_TILL_NUMBER: '  ' });
    await stk.initiateStkPush(STK_REQUEST);
    expect(post.mock.calls[0][1].TransactionType).toBe('CustomerPayBillOnline');
  });

  it('refuses to start with a till number that is not digits', () => {
    expect(() => loadWith({ MPESA_TILL_NUMBER: '512-3456' })).toThrow(
      /MPESA_TILL_NUMBER must be digits only/,
    );
  });
});
