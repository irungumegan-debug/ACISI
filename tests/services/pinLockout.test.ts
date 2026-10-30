// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());

import { resetFakeRedis } from '../helpers/fakeRedis';
import { PIN_LOCKOUT } from '../../src/config/constants';
import { clearLockout, isLockedOut, lockoutMessage, recordWrongPin } from '../../src/services/pinLockout';

beforeEach(() => {
  resetFakeRedis();
  jest.useRealTimers();
});

describe('PIN_LOCKOUT setting', () => {
  it('is 5 wrong PINs within 5 minutes, then locked for 5 minutes', () => {
    expect(PIN_LOCKOUT).toEqual({ maxAttempts: 5, windowMinutes: 5, lockMinutes: 5 });
  });

  it('builds the message from the setting', () => {
    expect(lockoutMessage()).toBe('Too many wrong PINs. Try again in 5 minutes.');
    expect(lockoutMessage('passwords')).toBe('Too many wrong passwords. Try again in 5 minutes.');
  });
});

describe('per-account lockout', () => {
  it('locks on the 5th wrong PIN, not before', async () => {
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts - 1; i++) {
      expect(await recordWrongPin('patient:p1')).toBe(false);
      expect(await isLockedOut('patient:p1')).toBe(false);
    }
    expect(await recordWrongPin('patient:p1')).toBe(true);
    expect(await isLockedOut('patient:p1')).toBe(true);
  });

  it('keeps accounts separate', async () => {
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts; i++) await recordWrongPin('staff:s1');
    expect(await isLockedOut('staff:s1')).toBe(true);
    expect(await isLockedOut('staff:s2')).toBe(false);
    expect(await isLockedOut('patient:s1')).toBe(false);
  });

  it('unlocks by itself after lockMinutes', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T09:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts; i++) await recordWrongPin('patient:p1');
    jest.setSystemTime(new Date(Date.now() + (PIN_LOCKOUT.lockMinutes * 60 - 1) * 1000));
    expect(await isLockedOut('patient:p1')).toBe(true);
    jest.setSystemTime(new Date(Date.now() + 2000));
    expect(await isLockedOut('patient:p1')).toBe(false);
  });

  it('forgets old wrong PINs after windowMinutes', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T09:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts - 1; i++) await recordWrongPin('patient:p1');
    jest.setSystemTime(new Date(Date.now() + PIN_LOCKOUT.windowMinutes * 60 * 1000 + 1000));
    expect(await recordWrongPin('patient:p1')).toBe(false);
  });

  it('clearLockout (correct PIN or PIN reset) lifts the lock and resets the count', async () => {
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts; i++) await recordWrongPin('patient:p1');
    await clearLockout('patient:p1');
    expect(await isLockedOut('patient:p1')).toBe(false);
    expect(await recordWrongPin('patient:p1')).toBe(false);
  });
});
