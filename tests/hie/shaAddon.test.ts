jest.mock('../../src/db/prisma', () => ({ prisma: { clinic: { findUnique: jest.fn() } } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());

import { prisma } from '../../src/db/prisma';
import { env } from '../../src/config/env';
import { HieError } from '../../src/hie/client';
import { requireShaAddon, shaAddonOn, shaAddonStatus } from '../../src/hie/shaAddon';

const findClinic = prisma.clinic.findUnique as jest.Mock;
const setServer = (on: boolean) => ((env as { SHA_ENABLED: boolean }).SHA_ENABLED = on);

afterEach(() => {
  setServer(false);
  findClinic.mockReset();
});

describe('SHA add-on switch (server SHA_ENABLED + clinic switch, both off by default)', () => {
  it('is off by default on the server', () => {
    expect(env.SHA_ENABLED).toBe(false);
  });

  it('is off when the server switch is off, even if the clinic is switched on (and does not even look the clinic up)', async () => {
    findClinic.mockResolvedValue({ shaAddonEnabled: true });
    expect(await shaAddonOn('c1')).toBe(false);
    expect(findClinic).not.toHaveBeenCalled();
    await expect(requireShaAddon('c1')).rejects.toBeInstanceOf(HieError);
  });

  it('is off when the server is on but the clinic is not', async () => {
    setServer(true);
    findClinic.mockResolvedValue({ shaAddonEnabled: false });
    expect(await shaAddonOn('c1')).toBe(false);
    await expect(requireShaAddon('c1')).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('is off for an unknown clinic', async () => {
    setServer(true);
    findClinic.mockResolvedValue(null);
    expect(await shaAddonOn('nope')).toBe(false);
  });

  it('is on only when both are on', async () => {
    setServer(true);
    findClinic.mockResolvedValue({ shaAddonEnabled: true });
    expect(await shaAddonOn('c1')).toBe(true);
    await expect(requireShaAddon('c1')).resolves.toBeUndefined();
    expect(await shaAddonStatus('c1')).toEqual({ enabled: true, connected: false });
  });
});
