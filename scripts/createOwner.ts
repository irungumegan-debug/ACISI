/**
 * Creates the platform owner account for the owner site (/owner), or resets
 * its password if one already exists for that email (which also logs out
 * every open owner session). Run directly from the Railway console — there
 * is deliberately no HTTP endpoint or signup form that creates an owner, so
 * only someone who already has production console access can make one.
 *
 * Usage: npm run create-owner -- <email> "<Full Name>"
 *
 * The password is asked for interactively (not passed as an argument) so it
 * never lands in shell history or the process list. For non-interactive use
 * it can instead be supplied via the OWNER_PASSWORD environment variable.
 */
import readline from 'node:readline';
import { prisma } from '../src/db/prisma';
import { redis, redisQueueConnection } from '../src/config/redis';
import { createOrResetOwner, InvalidOwnerInputError } from '../src/services/ownerService';
import { OWNER_PASSWORD_MIN_LENGTH } from '../src/config/constants';

const email = process.argv[2];
const name = process.argv[3];

if (!email || !name) {
  console.error('Usage: npm run create-owner -- <email> "<Full Name>"');
  process.exit(1);
}

/** Reads one line from the terminal without echoing what's typed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    output._writeToOutput = (s: string) => {
      if (!prompted) {
        output.output.write(s);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  if (process.env.OWNER_PASSWORD) return process.env.OWNER_PASSWORD;

  const password = await promptHidden(`Choose a password (at least ${OWNER_PASSWORD_MIN_LENGTH} characters): `);
  const confirmation = await promptHidden('Type it again to confirm: ');
  if (password !== confirmation) {
    throw new InvalidOwnerInputError('The two passwords did not match. Nothing was changed.');
  }
  return password;
}

readPassword()
  .then((password) => createOrResetOwner({ email, name, password }))
  .then(({ owner, created }) => {
    console.log(
      created
        ? `Owner account created for ${owner.name} (${owner.email}). Sign in at /owner.`
        : `Password reset for ${owner.name} (${owner.email}). Any open owner sessions have been logged out.`,
    );
  })
  .catch((err) => {
    if (err instanceof InvalidOwnerInputError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    // Redis is opened as a side effect of importing the session-revocation
    // code; left open, it would keep this script running after it's done.
    await Promise.all([prisma.$disconnect(), redis.quit(), redisQueueConnection.quit()]);
  });
