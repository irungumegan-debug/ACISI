import { prisma } from '../db/prisma';
import { emailClient, emailConfigured, emailFromHeader } from '../config/email';
import { recordAuditEvent } from './auditService';
import { lastFullWeekStart, weeklySummary, weeklySummaryCsv } from './notifiableDiseaseService';
import { logger } from '../utils/logger';

/**
 * Electronic reporting to the Sub-County Disease Surveillance Coordinator
 * (SCDSC), by email, for clinics whose admin has entered the coordinator's
 * address:
 *
 * - Weekly: every Monday from 08:00 (Kenya time), last week's MOH 505
 *   summary (CSV attached). Sent once per week per clinic.
 * - Immediate: as soon as an immediately reportable disease is diagnosed or
 *   an immediate public health event is recorded: the clinic, the disease or
 *   event type and the time, and whether it is an IHR disease.
 *
 * Never patient names, phone numbers or ID numbers: the email service is
 * outside Kenya, and the coordinator calls the clinic for the case form
 * (MOH 502), as the IDSR guidelines expect. Staff still mark each case as
 * reported in ACISI once the coordinator has it. Never throws.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validSurveillanceEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 200;
}

export function surveillanceEmailAvailable(): boolean {
  return emailConfigured && emailClient !== null;
}

async function send(to: string, subject: string, text: string, attachment?: { filename: string; content: Buffer }): Promise<boolean> {
  if (!surveillanceEmailAvailable()) return false;
  const result = await emailClient!.emails.send({ from: emailFromHeader, to: [to], subject, text, ...(attachment ? { attachments: [attachment] } : {}) });
  if (result.error) throw new Error(`Resend rejected the email: ${result.error.message}`);
  return true;
}

const kenyaTime = (d: Date) => d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' });

/** Immediate notice to the coordinator: what and when, no patient details. */
export async function emailImmediateNotice(input: {
  clinicId: string;
  kind: 'case' | 'event';
  items: { name: string; ihr?: 'ALWAYS' | 'ASSESS' | null }[];
  at: Date;
  entityType: string;
  entityId: string;
}): Promise<void> {
  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true, county: true, surveillanceEmail: true } });
    if (!clinic?.surveillanceEmail || !surveillanceEmailAvailable()) return;
    const lines = input.items.map((i) => `- ${i.name}${i.ihr ? ' (IHR disease: report to the national IHR focal point)' : ''}`);
    const what = input.kind === 'case' ? 'suspected case of an immediately reportable disease' : 'public health event';
    const text = [
      `Immediate notification from ${clinic.name}${clinic.county ? `, ${clinic.county} County` : ''}.`,
      '',
      `A ${what} was recorded on ${kenyaTime(input.at)}:`,
      ...lines,
      '',
      `Patient details are not included in this email. Please call ${clinic.name} for the case details (MOH 502).`,
      '',
      'Sent automatically by ACISI on behalf of the clinic.',
    ].join('\n');
    const sent = await send(clinic.surveillanceEmail, `IMMEDIATE: ${input.items.map((i) => i.name).join(', ')} at ${clinic.name}`, text);
    await recordAuditEvent({
      actorType: 'SYSTEM',
      clinicId: input.clinicId,
      action: sent ? 'SURVEILLANCE_IMMEDIATE_EMAIL_SENT' : 'SURVEILLANCE_IMMEDIATE_EMAIL_SKIPPED',
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: { kind: input.kind, items: input.items.length },
    });
  } catch (err) {
    logger.error({ err, clinicId: input.clinicId }, 'Immediate surveillance email failed');
    await recordAuditEvent({ actorType: 'SYSTEM', clinicId: input.clinicId, action: 'SURVEILLANCE_IMMEDIATE_EMAIL_FAILED', entityType: input.entityType, entityId: input.entityId }).catch(() => undefined);
  }
}

/** Kenya time: is it Monday 08:00 or later? */
export function isMondayMorningOrLater(now: Date = new Date()): boolean {
  const k = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return k.getUTCDay() === 1 && k.getUTCHours() >= 8;
}

/** Hourly task: on Mondays from 08:00, email last week's MOH 505 summary to each clinic's coordinator, once. */
export async function sendWeeklySurveillanceEmails(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  if (!surveillanceEmailAvailable() || !isMondayMorningOrLater(now)) return { sent: 0, failed: 0 };
  const week = lastFullWeekStart(now);
  const clinics = await prisma.clinic.findMany({
    where: { isActive: true, surveillanceEmail: { not: null }, OR: [{ surveillanceWeeklySentFor: null }, { surveillanceWeeklySentFor: { not: week } }] },
    select: { id: true, name: true, surveillanceEmail: true },
  });
  let sent = 0;
  let failed = 0;
  for (const clinic of clinics) {
    try {
      const summary = await weeklySummary(clinic.id, week);
      const csv = weeklySummaryCsv(summary);
      const text = [
        `Weekly IDSR summary (MOH 505) from ${clinic.name}, week ${summary.weekStart} to ${summary.weekEnd}.`,
        '',
        'The summary is attached as a CSV file (counts only, no patient details). Rows ACISI cannot count from diagnoses are marked; the clinic fills those in by hand.',
        '',
        'Sent automatically by ACISI on behalf of the clinic.',
      ].join('\n');
      await send(clinic.surveillanceEmail!, `Weekly IDSR summary (MOH 505): ${clinic.name}, week of ${summary.weekStart}`, text, {
        filename: `MOH505-${clinic.name.replace(/[^\w-]+/g, '-')}-${summary.weekStart}.csv`,
        content: Buffer.from(csv, 'utf8'),
      });
      await prisma.clinic.update({ where: { id: clinic.id }, data: { surveillanceWeeklySentFor: week } });
      await recordAuditEvent({ actorType: 'SYSTEM', clinicId: clinic.id, action: 'SURVEILLANCE_WEEKLY_EMAIL_SENT', entityType: 'Clinic', entityId: clinic.id, metadata: { week } });
      sent++;
    } catch (err) {
      failed++;
      logger.error({ err, clinicId: clinic.id, week }, 'Weekly surveillance email failed');
    }
  }
  return { sent, failed };
}
