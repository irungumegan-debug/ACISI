// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());

import { getMpesaHealth, notePromptFailed, notePromptResult } from '../../src/services/mpesaHealth';
import { MPESA_FAILURE_WARNING_THRESHOLD } from '../../src/config/constants';
import { resetFakeRedis } from '../helpers/fakeRedis';

beforeEach(() => resetFakeRedis());

describe('owner warning: "M-Pesa prompts are failing" (C20)', () => {
  it('warns after 3 prompts in a row fail or time out', async () => {
    expect(MPESA_FAILURE_WARNING_THRESHOLD).toBe(3);
    await notePromptFailed(); // could not be sent
    await notePromptResult(1037); // phone unreachable / timed out
    expect((await getMpesaHealth()).failing).toBe(false);
    await notePromptResult(1019); // prompt expired
    const health = await getMpesaHealth();
    expect(health).toMatchObject({
      failing: true,
      consecutiveFailures: 3,
      threshold: 3,
      lastSuccessAt: null,
    });
    expect(health.failingSince).toEqual(expect.any(String));
  });

  it("the patient's own decision (cancelled, no balance, wrong PIN) neither raises nor clears it", async () => {
    for (const code of [1032, 1, 2001, 1032]) await notePromptResult(code);
    expect((await getMpesaHealth()).consecutiveFailures).toBe(0);

    for (let i = 0; i < 3; i++) await notePromptFailed();
    await notePromptResult(1032);
    expect((await getMpesaHealth()).failing).toBe(true);
  });

  it('a successful payment clears it and records the time of the last successful payment', async () => {
    for (let i = 0; i < 4; i++) await notePromptFailed();
    await notePromptResult(0);
    const health = await getMpesaHealth();
    expect(health).toMatchObject({ failing: false, consecutiveFailures: 0, failingSince: null });
    expect(new Date(health.lastSuccessAt!).getTime()).toBeGreaterThan(Date.now() - 5000);

    // …and the last success is still shown once it starts failing again.
    for (let i = 0; i < 3; i++) await notePromptFailed();
    expect(await getMpesaHealth()).toMatchObject({ failing: true, lastSuccessAt: health.lastSuccessAt });
  });
});
