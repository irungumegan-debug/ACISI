import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { decryptResult, encryptWritePayload } from '../utils/fieldCrypto';

const WRITE_KEYS = ['data', 'create', 'update'] as const;

/**
 * Health data and identity documents are encrypted at rest (AES-256-GCM,
 * see utils/fieldCrypto.ts): every write through this client encrypts them,
 * every read decrypts them, so the rest of the code never sees ciphertext.
 */
export function withFieldEncryption(client: PrismaClient) {
  return client.$extends({
    name: 'field-encryption',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const a = args as Record<string, unknown> | undefined;
          if (a) for (const k of WRITE_KEYS) if (a[k] !== undefined) a[k] = encryptWritePayload(a[k]);
          return decryptResult(await query(args));
        },
      },
    },
  });
}

function createClient() {
  return withFieldEncryption(
    new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    }),
  );
}

// Reuse a single client across ts-node-dev hot reloads in development to
// avoid exhausting the Postgres connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The extension only adds query hooks (no new models or fields), so the
// plain client type is exact; it keeps transaction types working everywhere.
export const prisma: PrismaClient = globalForPrisma.prisma ?? (createClient() as unknown as PrismaClient);

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

