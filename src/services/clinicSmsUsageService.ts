import { prisma } from '../db/prisma';
import { CLINIC_PLANS, SMS_OVERAGE_KES } from '../config/constants';
import { kenyaDayRange, kenyaToday } from '../utils/kenyaTime';

/**
 * C24: SMS sent to patients on each clinic's behalf, per calendar month
 * (Kenya time), against the clinic's allowance. Counted in billed SMS
 * parts, which is what Africa's Talking charges for. Counts are never
 * reset or deleted: a month is simply the rows sent within it.
 */

/** "2026-10" for the month `offset` months from the one containing `now` (Kenya time). */
export function kenyaMonth(now: Date = new Date(), offset = 0): string {
  const [y, m] = kenyaToday(now).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

/** The UTC instants bounding a Kenyan calendar month: [start, end). */
export function kenyaMonthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start: kenyaDayRange(`${month}-01`).start, end: kenyaDayRange(next).start };
}

export interface SmsUsage {
  month: string;
  messages: number;
  /** Billed SMS parts: what counts against the allowance. */
  sms: number;
  allowance: number;
  over: number;
  extraChargeKes: number;
}

/** Over-allowance figures: e.g. 620 SMS on 500 -> 120 over, KES 240. */
export function overage(sms: number, allowance: number): { over: number; extraChargeKes: number } {
  const over = Math.max(0, sms - allowance);
  return { over, extraChargeKes: over * SMS_OVERAGE_KES };
}

async function countFor(clinicIds: string[], month: string): Promise<Map<string, { messages: number; sms: number }>> {
  const { start, end } = kenyaMonthRange(month);
  const rows = await prisma.clinicSmsMessage.groupBy({
    by: ['clinicId'],
    where: { clinicId: { in: clinicIds }, sentAt: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { parts: true },
  });
  return new Map(rows.map((r) => [r.clinicId, { messages: r._count._all, sms: r._sum.parts ?? 0 }]));
}

/** Usage for several clinics in one month, using each clinic's current allowance. */
export async function getSmsUsage(clinics: { id: string; smsMonthlyAllowance: number }[], month: string): Promise<Map<string, SmsUsage>> {
  const counts = await countFor(clinics.map((c) => c.id), month);
  return new Map(
    clinics.map((c) => {
      const { messages, sms } = counts.get(c.id) ?? { messages: 0, sms: 0 };
      return [c.id, { month, messages, sms, allowance: c.smsMonthlyAllowance, ...overage(sms, c.smsMonthlyAllowance) }];
    }),
  );
}

export function planLabel(plan: keyof typeof CLINIC_PLANS): string {
  return CLINIC_PLANS[plan].label;
}
