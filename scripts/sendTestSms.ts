/**
 * Sends one test SMS through the live provider (Mobile Sasa once
 * MOBILESASA_API_TOKEN is set), to check delivery end to end. Run on the
 * server. Prints only the outcome: never the token, and the number masked.
 *
 * Usage: npm run send-test-sms -- 07XXXXXXXX
 */
import { redis } from '../src/config/redis';
import { prisma } from '../src/db/prisma';
import { sendSms, smsCanReach, smsProvider, SMS_SAFARICOM_ONLY_NOTE } from '../src/services/smsService';
import { maskPhoneForLog, toE164 } from '../src/utils/phone';

async function main(): Promise<void> {
  let phone: string;
  try {
    phone = toE164(process.argv[2] ?? '');
  } catch {
    console.error('Usage: npm run send-test-sms -- 07XXXXXXXX (a Kenyan mobile number)');
    process.exitCode = 1;
    return;
  }
  const masked = maskPhoneForLog(phone);
  console.log(`Provider: ${smsProvider()}`);
  if (!smsCanReach(phone)) {
    console.error(`${SMS_SAFARICOM_ONLY_NOTE} ${masked} is not a Safaricom number, so nothing was sent.`);
    process.exitCode = 1;
    return;
  }
  const outcome = await sendSms(phone, 'ACISI test message: SMS is working.', 'TEST_SMS');
  if (outcome === 'sent') {
    console.log(`Accepted by ${smsProvider()} for ${masked}. Check the phone: it should arrive from "ACISI" within a minute.`);
  } else {
    console.error(`NOT sent to ${masked}. See: sudo journalctl -u acisi -n 20 --no-pager | grep SMS (or the line above, with the error code).`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Test SMS failed:', err instanceof Error ? err.name : 'error');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
