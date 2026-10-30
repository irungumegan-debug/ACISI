/**
 * One-off clean-up for C14: removes phone numbers already stored on clinic
 * checkout payments (payments.phoneNumber, and any phone number inside
 * Safaricom's stored reply, payments.rawCallbackPayload). Payment method,
 * amount, M-Pesa code and the staff member who took it are kept.
 *
 * Safe by default: without --apply it only PRINTS how many payments it
 * would change, and changes nothing. Prints counts only, never a number.
 *
 *   npm run redact-payment-phones              # preview, changes nothing
 *   npm run redact-payment-phones -- --apply   # do it (take a backup first)
 *
 * Running it again later is harmless: it finds nothing left to change.
 * It does not touch the ACISI check-in fee records (mpesa_transactions).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/db/prisma';
import { redactPhoneNumbers } from '../src/utils/redactPhoneNumbers';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const payments = await prisma.payment.findMany({ select: { id: true, phoneNumber: true, rawCallbackPayload: true } });

  const toChange = payments.filter((p) => {
    if (p.phoneNumber !== null) return true;
    if (p.rawCallbackPayload === null) return false;
    return JSON.stringify(redactPhoneNumbers(p.rawCallbackPayload)) !== JSON.stringify(p.rawCallbackPayload);
  });
  const withPhoneColumn = toChange.filter((p) => p.phoneNumber !== null).length;

  console.log(`Clinic payments checked: ${payments.length}`);
  console.log(`Payments holding a phone number: ${toChange.length} (${withPhoneColumn} in the phone column, the rest only inside the stored M-Pesa reply)`);

  if (!apply) {
    console.log('PREVIEW ONLY: nothing was changed. Run again with --apply to remove them (take a backup first).');
    return;
  }

  let done = 0;
  for (const p of toChange) {
    await prisma.payment.update({
      where: { id: p.id },
      data: {
        phoneNumber: null,
        rawCallbackPayload:
          p.rawCallbackPayload === null ? undefined : (redactPhoneNumbers(p.rawCallbackPayload) as Prisma.InputJsonValue),
      },
    });
    done += 1;
  }
  console.log(`Done: phone numbers removed from ${done} payments.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.name : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
