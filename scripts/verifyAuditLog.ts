/**
 * Checks the audit log's hash chain (migration 20261114120000): every row's
 * hash must match its content and the previous row's hash. Any changed,
 * removed or inserted row shows up here. Read-only.
 *
 *   sudo bash -c 'set -a; . /etc/acisi/acisi.env; set +a; cd /opt/acisi/app && npm run -s verify-audit-log'
 */
import { PrismaClient } from '@prisma/client';

// Only needs DATABASE_URL, so it runs without the app's other settings.
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [counts] = await prisma.$queryRaw<{ total: bigint; unchained: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE "hash" IS NULL) AS unchained FROM "audit_logs"`;
  const broken = await prisma.$queryRaw<{ id: string; createdAt: Date; problem: string }[]>`
    SELECT id, "createdAt",
      CASE WHEN "prevHash" IS DISTINCT FROM coalesce(expected_prev, '') THEN 'previous row missing or changed'
           ELSE 'row content changed' END AS problem
    FROM (
      SELECT a.id, a."createdAt", a."prevHash", a."hash",
             lag(a."hash") OVER (ORDER BY a."createdAt", a.id) AS expected_prev,
             encode(sha256(convert_to(a."prevHash" || chr(30) || audit_log_row_text(a), 'UTF8')), 'hex') AS recomputed
      FROM "audit_logs" a WHERE a."hash" IS NOT NULL
    ) t
    WHERE "prevHash" IS DISTINCT FROM coalesce(expected_prev, '') OR "hash" <> recomputed
    ORDER BY "createdAt" LIMIT 20`;

  console.log(`Audit log rows: ${counts!.total}`);
  if (counts!.unchained > 0n) console.log(`Rows without a hash: ${counts!.unchained} (should be 0)`);
  if (broken.length === 0 && counts!.unchained === 0n) {
    console.log('Audit log chain intact: no row has been changed, removed or inserted.');
    return;
  }
  for (const b of broken) console.log(`BROKEN at ${b.createdAt.toISOString()} (row ${b.id}): ${b.problem}`);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
