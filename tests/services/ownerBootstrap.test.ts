jest.mock('../../src/db/prisma', () => ({
  prisma: { platformOwner: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ revokeSessionsFor: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import bcrypt from 'bcrypt';
import { prisma } from '../../src/db/prisma';
import { logger } from '../../src/utils/logger';
import { ensureOwnerFromEnv } from '../../src/services/ownerService';

const mockFind = prisma.platformOwner.findUnique as jest.Mock;
const mockCreate = prisma.platformOwner.create as jest.Mock;
const mockUpdate = prisma.platformOwner.update as jest.Mock;

const PASSWORD = 'correct-horse-battery';
const CONFIG = { email: ' Boss@ACISI.co.ke ', name: 'Megan Irungu', password: PASSWORD };

function everythingLogged(): string {
  return JSON.stringify([
    (logger.info as jest.Mock).mock.calls,
    (logger.warn as jest.Mock).mock.calls,
    (logger.error as jest.Mock).mock.calls,
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockResolvedValue(null);
  mockCreate.mockImplementation(async ({ data }) => ({ id: 'owner-1', ...data }));
});

describe('ensureOwnerFromEnv', () => {
  it('does nothing at all when no OWNER_* variables are set', async () => {
    await ensureOwnerFromEnv({});
    expect(mockFind).not.toHaveBeenCalled();
    expect(everythingLogged()).toBe('[[],[],[]]');
  });

  it('creates the owner, storing only a bcrypt hash of the password', async () => {
    await ensureOwnerFromEnv(CONFIG);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { data } = mockCreate.mock.calls[0]![0];
    expect(data.email).toBe('boss@acisi.co.ke');
    expect(data.name).toBe('Megan Irungu');
    expect(data).not.toHaveProperty('password');
    expect(data.passwordHash).not.toContain(PASSWORD);
    await expect(bcrypt.compare(PASSWORD, data.passwordHash)).resolves.toBe(true);
  });

  it('never overwrites an existing owner, so a leftover variable cannot reset the password', async () => {
    mockFind.mockResolvedValue({ id: 'owner-1', email: 'boss@acisi.co.ke' });
    await ensureOwnerFromEnv({ ...CONFIG, password: 'some-other-password' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/already exists/));
  });

  it('skips with a warning naming (not revealing) what is missing', async () => {
    await ensureOwnerFromEnv({ email: 'boss@acisi.co.ke', password: PASSWORD });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ missing: ['OWNER_NAME'] }, expect.any(String));
  });

  it('refuses a short password without crashing the server', async () => {
    await expect(ensureOwnerFromEnv({ ...CONFIG, password: 'short' })).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({ reason: expect.stringMatching(/at least 12/) }, expect.any(String));
  });

  it('never writes the password to the logs, on any path', async () => {
    await ensureOwnerFromEnv(CONFIG);
    mockFind.mockResolvedValue({ id: 'owner-1' });
    await ensureOwnerFromEnv(CONFIG);
    mockFind.mockRejectedValue(new Error('db down'));
    await ensureOwnerFromEnv(CONFIG);
    await ensureOwnerFromEnv({ email: 'x@y.co', password: PASSWORD });
    expect(everythingLogged()).not.toContain(PASSWORD);
  });

  it('treats a simultaneous create by another server instance as success', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await ensureOwnerFromEnv(CONFIG);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
