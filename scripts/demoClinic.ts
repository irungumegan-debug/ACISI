/**
 * Demo clinics, for showing ACISI to a prospective clinic. Each one is
 * described by demo/<key>.json.
 *
 *   npm run demo -- seed westlands      create it (refuses if it exists)
 *   npm run demo -- reset westlands     wipe it and create it fresh
 *   npm run demo -- delete westlands    show what would be removed
 *   npm run demo -- delete westlands --yes   remove it completely
 *
 * Only the named demo clinic and its fake patients are ever touched. All
 * demo logins share one PIN: set DEMO_PIN to choose it, otherwise a random
 * one is printed. See deploy/RUNBOOK.md ("Demo clinics") for the server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db/prisma';
import { redis, redisQueueConnection } from '../src/config/redis';
import {
  DemoClinicError,
  DemoSeedResult,
  deleteDemoClinic,
  resetDemoClinic,
  seedDemoClinic,
} from '../src/services/demoClinicService';

const [command, key, flag] = process.argv.slice(2);
const SITE = 'https://acisi.co.ke';

function usage(): never {
  console.error(
    'Usage: npm run demo -- <seed|reset|delete> <key> [--yes]   (key = a file in demo/, e.g. westlands)',
  );
  process.exit(1);
}

function loadConfig(demoKey: string): unknown {
  if (!/^[a-z0-9-]+$/.test(demoKey)) usage();
  const file = path.join(__dirname, '..', 'demo', `${demoKey}.json`);
  if (!fs.existsSync(file)) throw new DemoClinicError(`No config at demo/${demoKey}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function printSeed(result: DemoSeedResult, demoKey: string): void {
  console.log(`\n${result.clinicName} is ready, with ${result.patientCount} patients in today's queue.\n`);
  console.log(`Staff console:  ${SITE}/console   (PIN for every login below: ${result.pin})`);
  for (const l of result.logins) {
    const depts = l.departments.length ? `  ${l.departments.join(', ')}` : '';
    console.log(`  ${l.role.padEnd(13)} ${l.staffCode.padEnd(9)} ${l.name}${depts}`);
  }
  console.log(`\nPatient demo link: ${SITE}/patient?demo=${demoKey}`);
  console.log('Each login asks to accept the Terms the first time it signs in.\n');
}

async function main(): Promise<void> {
  if (!command || !key) usage();
  if (command === 'seed') {
    printSeed(await seedDemoClinic(loadConfig(key), { pin: process.env.DEMO_PIN }), key);
  } else if (command === 'reset') {
    printSeed(await resetDemoClinic(loadConfig(key), { pin: process.env.DEMO_PIN }), key);
  } else if (command === 'delete') {
    const clinic = await prisma.clinic.findUnique({ where: { demoKey: key } });
    if (!clinic) {
      console.log(`There is no demo "${key}". Nothing to delete.`);
      return;
    }
    if (flag !== '--yes') {
      const [visits, staff, patients] = await Promise.all([
        prisma.encounter.count({ where: { clinicId: clinic.id } }),
        prisma.staff.count({ where: { clinicId: clinic.id } }),
        prisma.patient.count({ where: { demoClinicId: clinic.id } }),
      ]);
      console.log(
        `This would permanently remove ${clinic.name}: ${visits} visits, ${staff} staff logins and ${patients} fake patients.`,
      );
      console.log('Run the same command again with --yes at the end to do it.');
      return;
    }
    const result = await deleteDemoClinic(key);
    console.log(`${clinic.name} has been removed.`);
    if (result.keptPatientIds.length) {
      console.log(
        `Kept ${result.keptPatientIds.length} demo patient(s) who also have visits at another clinic.`,
      );
    }
  } else {
    usage();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof DemoClinicError ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), redis.quit(), redisQueueConnection.quit()]);
  });
