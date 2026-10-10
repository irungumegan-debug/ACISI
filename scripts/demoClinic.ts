/**
 * Demo clinics, for showing ACISI to a prospective clinic in person.
 *
 *   npm run demo -- seed --key alina --name "Alina Medical Centre" --location Hurlingham \
 *       --departments "General Consultation:G,Paediatrics:P,Gynaecology & Antenatal:GY,Laboratory:L,Pharmacy:PH"
 *   npm run demo -- reset alina           put it back exactly as seeded (run before each demo)
 *   npm run demo -- show alina            print the logins and patients again
 *   npm run demo -- list                  every demo clinic
 *   npm run demo -- delete alina          show what would be removed
 *   npm run demo -- delete alina --yes    remove it completely
 *
 * Seed options: --county (default Nairobi), --login-prefix (default: the
 * name's initials), --phone-block 0–9 (default: the first free one). A
 * department is "Name:CODE" or "Name:CODE:FEE" (consultation fee in KES).
 *
 * All demo logins and demo patients share one PIN: set DEMO_PIN to choose it
 * (seed, or reset to change it), otherwise seed prints a random one. See
 * deploy/RUNBOOK.md ("Demo clinics") for running this on the server.
 */
import { prisma } from '../src/db/prisma';
import { redis, redisQueueConnection } from '../src/config/redis';
import {
  DemoClinicError,
  DemoSeedResult,
  deleteDemoClinic,
  describeDemoClinic,
  listDemoClinics,
  parseDepartmentList,
  resetDemoClinic,
  seedDemoClinic,
} from '../src/services/demoClinicService';

const SITE = process.env.DEMO_SITE_URL ?? 'https://acisi.co.ke';

function usage(): never {
  console.error(
    [
      'Usage:',
      '  npm run demo -- seed --key <key> --name "<Clinic name>" --location "<Area>" --departments "<Name:CODE,...>"',
      '                       [--county Nairobi] [--login-prefix ABC] [--phone-block 0-9]',
      '  npm run demo -- reset <key>',
      '  npm run demo -- show <key>',
      '  npm run demo -- list',
      '  npm run demo -- delete <key> [--yes]',
    ].join('\n'),
  );
  process.exit(1);
}

/** --flag value pairs (and bare words) from the command line. */
function parseArgs(args: string[]): { words: string[]; flags: Record<string, string> } {
  const words: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--yes') flags.yes = 'true';
    else if (arg.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new DemoClinicError(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i++;
    } else words.push(arg);
  }
  return { words, flags };
}

function print(result: DemoSeedResult, heading: string): void {
  const rows = (cells: string[][]) => {
    const widths = cells[0]!.map((_, c) => Math.max(...cells.map((r) => r[c]!.length)));
    for (const r of cells) console.log(`  ${r.map((cell, c) => cell.padEnd(widths[c]!)).join('   ')}`);
  };
  console.log(`\n${heading}: ${result.clinicName}\n`);
  console.log(`Patient website:  ${SITE}/patient?demo=${result.key}`);
  console.log(`Staff & doctors:  ${SITE}/console`);
  console.log(`PIN for every login and demo patient below: ${result.pin}\n`);
  console.log('Staff logins (Staff ID + PIN):');
  rows(result.logins.map((l) => [l.staffCode, l.name, l.role, l.departments.join(', ')]));
  console.log('\nDemo patients (phone + PIN on the patient website):');
  rows(result.patients.map((p) => [p.phone, p.name, p.note]));
  console.log('\nPayments here are simulated: nothing is charged, and no SMS or M-Pesa prompt is ever sent.');
  console.log('Each login asks to accept the Terms the first time it signs in; reset keeps that.\n');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { words, flags } = parseArgs(rest);
  const pin = process.env.DEMO_PIN || undefined;

  switch (command) {
    case 'seed': {
      if (!flags.key || !flags.name || !flags.location || !flags.departments) usage();
      const result = await seedDemoClinic(
        {
          key: flags.key,
          name: flags.name,
          location: flags.location,
          ...(flags.county ? { county: flags.county } : {}),
          ...(flags['login-prefix'] ? { loginPrefix: flags['login-prefix'] } : {}),
          ...(flags['phone-block'] !== undefined ? { phoneBlock: Number(flags['phone-block']) } : {}),
          departments: parseDepartmentList(flags.departments),
        },
        { pin },
      );
      print(result, 'Created');
      return;
    }
    case 'reset': {
      if (!words[0]) usage();
      print(await resetDemoClinic(words[0], { pin }), 'Reset to its seeded state');
      return;
    }
    case 'show': {
      if (!words[0]) usage();
      print(await describeDemoClinic(words[0]), 'Demo');
      return;
    }
    case 'list': {
      const demos = await listDemoClinics();
      if (!demos.length) console.log('No demo clinics.');
      for (const d of demos) console.log(`  ${d.key.padEnd(16)} ${d.name}`);
      return;
    }
    case 'delete': {
      const key = words[0];
      if (!key) usage();
      if (flags.yes !== 'true') {
        const clinic = await prisma.clinic.findUnique({ where: { demoKey: key } });
        if (!clinic) {
          console.log(`There is no demo "${key}". Nothing to delete.`);
          return;
        }
        if (!clinic.isDemo)
          throw new DemoClinicError(`Clinic "${clinic.name}" is not a demo clinic; refusing to delete it.`);
        const [visits, staff, patients] = await Promise.all([
          prisma.encounter.count({ where: { clinicId: clinic.id } }),
          prisma.staff.count({ where: { clinicId: clinic.id } }),
          prisma.patient.count({ where: { demoClinicId: clinic.id } }),
        ]);
        console.log(
          `This would permanently remove ${clinic.name}: ${visits} visits, ${staff} staff logins and ${patients} demo patients.`,
        );
        console.log('Run the same command again with --yes at the end to do it.');
        return;
      }
      const result = await deleteDemoClinic(key);
      console.log(
        result.deleted
          ? `${result.clinicName} has been removed.`
          : `There is no demo "${key}". Nothing to delete.`,
      );
      return;
    }
    default:
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
