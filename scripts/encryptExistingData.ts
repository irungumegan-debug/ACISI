/**
 * One-time: encrypts health data, ID documents and uploaded files that were
 * stored before encryption at rest was switched on. Safe to run again: what
 * is already encrypted is skipped. Preview by default; --apply to change.
 *
 *   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s encrypt-existing-data'
 *   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s encrypt-existing-data -- --apply'
 */
import { prisma } from '../src/db/prisma';
import { encryptionKey, ENCRYPTED_PREFIX } from '../src/utils/fieldCrypto';
import { encryptStoredFileInPlace } from '../src/services/fileStorageService';

const apply = process.argv.includes('--apply');

/** Rows where any of these fields still holds plaintext. */
function plaintextWhere(fields: string[]) {
  return { OR: fields.map((f) => ({ AND: [{ [f]: { not: null } }, { NOT: { [f]: { startsWith: ENCRYPTED_PREFIX } } }] })) };
}

type Delegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  update(args: unknown): Promise<unknown>;
};

const TABLES: { name: string; delegate: Delegate; fields: string[] }[] = [
  { name: 'visits', delegate: prisma.encounter as unknown as Delegate, fields: ['diagnosis', 'prescription', 'visitReason'] },
  { name: 'lab requests', delegate: prisma.labOrder as unknown as Delegate, fields: ['noteForLab'] },
  { name: 'lab results', delegate: prisma.labOrderItem as unknown as Delegate, fields: ['resultValue', 'resultComment'] },
  { name: 'patients', delegate: prisma.patient as unknown as Delegate, fields: ['idNumber', 'nextOfKinName', 'nextOfKinPhone'] },
  { name: 'pending signups', delegate: prisma.pendingPatientSignup as unknown as Delegate, fields: ['idNumber', 'nextOfKinName', 'nextOfKinPhone'] },
];

async function main(): Promise<void> {
  if (!encryptionKey()) throw new Error('DATA_ENCRYPTION_KEY is not set: nothing can be encrypted');
  console.log(apply ? 'Encrypting existing data…' : 'Preview only (nothing is changed). Add -- --apply to encrypt.');

  for (const t of TABLES) {
    const select = Object.fromEntries([['id', true], ...t.fields.map((f) => [f, true])]);
    const rows = await t.delegate.findMany({ where: plaintextWhere(t.fields), select });
    if (apply) {
      // Writing the (already decrypted) values back through the encrypting client stores them encrypted.
      for (const r of rows) {
        const data = Object.fromEntries(t.fields.filter((f) => r[f] !== null && r[f] !== undefined).map((f) => [f, r[f]]));
        await t.delegate.update({ where: { id: r.id }, data });
      }
    }
    console.log(`${t.name}: ${rows.length} ${apply ? 'encrypted' : 'to encrypt'}`);
  }

  const files = await prisma.patientFile.findMany({ select: { storageName: true } });
  let done = 0;
  let missing = 0;
  for (const f of files) {
    if (!apply) continue;
    try {
      if (await encryptStoredFileInPlace(f.storageName)) done++;
    } catch {
      missing++;
    }
  }
  console.log(apply ? `files: ${done} encrypted (${files.length} on record${missing ? `, ${missing} missing on disk` : ''})` : `files: ${files.length} on record (already encrypted ones are skipped)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
