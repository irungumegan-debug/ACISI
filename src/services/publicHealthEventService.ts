import { PublicHealthEventType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';
import { sendSms } from './smsService';
import { buildHealthEventAlertSms } from './smsTemplates';
import { logger } from '../utils/logger';

/**
 * Public health events (event-based surveillance, IDSR Technical Guidelines
 * 3rd edition): things a diagnosis code can't capture, recorded by clinic
 * staff as counts, never with patient names. Immediately reportable kinds
 * (Table 5: AEFI, maternal death, SARI, clusters and events of concern) alert
 * the clinic's admins and doctors by SMS. Each kind is also counted in its
 * MOH 505 weekly row (see EVENT_FORM_ROWS).
 */

export const EVENT_TYPES: Record<PublicHealthEventType, { label: string; immediate: boolean }> = {
  ILLNESS_CLUSTER: { label: 'Cluster of unwell people with similar symptoms', immediate: true },
  DEATH_CLUSTER: { label: 'Cluster of deaths in the community', immediate: true },
  ANIMAL_ILLNESS: { label: 'Unwell or dead animals with similar symptoms', immediate: true },
  AEFI: { label: 'Adverse event following immunization (AEFI)', immediate: true },
  SARI_CLUSTER: { label: 'SARI cluster (3 or more cases)', immediate: true },
  MATERNAL_DEATH: { label: 'Maternal death', immediate: true },
  NEONATAL_DEATH: { label: 'Neonatal death', immediate: false },
  MALARIA_DEATH: { label: 'Death due to malaria', immediate: false },
  OTHER_EVENT: { label: 'Other event of concern (food-borne, chemical, radio-nuclear, unknown)', immediate: true },
};

/**
 * The MOH 505 row (notifiableDiseases.ts id) each kind of event is counted in,
 * and whether that row counts the event's cases or its deaths.
 */
export const EVENT_FORM_ROWS: Record<PublicHealthEventType, { diseaseId: string; count: 'cases' | 'deaths' }> = {
  AEFI: { diseaseId: 'aefi', count: 'cases' },
  SARI_CLUSTER: { diseaseId: 'sari', count: 'cases' },
  MATERNAL_DEATH: { diseaseId: 'maternal-death', count: 'deaths' },
  NEONATAL_DEATH: { diseaseId: 'neonatal-deaths', count: 'deaths' },
  MALARIA_DEATH: { diseaseId: 'malaria-deaths', count: 'deaths' },
  ILLNESS_CLUSTER: { diseaseId: 'pheic', count: 'cases' },
  DEATH_CLUSTER: { diseaseId: 'pheic', count: 'cases' },
  ANIMAL_ILLNESS: { diseaseId: 'pheic', count: 'cases' },
  OTHER_EVENT: { diseaseId: 'pheic', count: 'cases' },
};

const count = z.number().int().min(0).max(100000);

export const recordEventSchema = z
  .object({
    type: z.nativeEnum(PublicHealthEventType),
    detectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD'),
    casesCount: count.default(0),
    casesUnder5: count.default(0),
    deathsCount: count.default(0),
    deathsUnder5: count.default(0),
    eventDescription: z.string().trim().min(5, 'Describe what happened').max(2000),
    eventPlace: z.string().trim().max(200).nullish(),
  })
  .refine((e) => e.casesUnder5 <= e.casesCount, { message: 'Cases under 5 can’t be more than all cases' })
  .refine((e) => e.deathsUnder5 <= e.deathsCount, { message: 'Deaths under 5 can’t be more than all deaths' })
  .refine((e) => e.casesCount + e.deathsCount > 0, { message: 'Enter how many people are affected or died' });

export type RecordEventInput = z.infer<typeof recordEventSchema>;

export class InvalidEventError extends Error {}

/** Kenya's date today (UTC+3), YYYY-MM-DD. */
export function kenyaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordPublicHealthEvent(input: RecordEventInput & { clinicId: string; staffId: string }, now: Date = new Date()) {
  const detected = new Date(`${input.detectedOn}T00:00:00Z`);
  if (Number.isNaN(detected.getTime()) || detected.toISOString().slice(0, 10) !== input.detectedOn) throw new InvalidEventError('Enter a real date');
  if (input.detectedOn > kenyaToday(now)) throw new InvalidEventError('The date can’t be in the future');
  if (input.type.endsWith('_DEATH') && input.deathsCount === 0) throw new InvalidEventError('Enter how many deaths');
  const event = await prisma.publicHealthEvent.create({
    data: {
      clinicId: input.clinicId,
      type: input.type,
      detectedOn: detected,
      casesCount: input.casesCount,
      casesUnder5: input.casesUnder5,
      deathsCount: input.deathsCount,
      deathsUnder5: input.deathsUnder5,
      eventDescription: input.eventDescription,
      eventPlace: input.eventPlace || null,
      recordedByStaffId: input.staffId,
    },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'PUBLIC_HEALTH_EVENT_RECORDED',
    entityType: 'PublicHealthEvent',
    entityId: event.id,
    metadata: { type: input.type, immediate: EVENT_TYPES[input.type].immediate },
  });
  if (EVENT_TYPES[input.type].immediate) void alertStaff(input.clinicId, event.id);
  return event;
}

/** SMS to the clinic's admins and doctors: no event details (phones are read by others). Never throws. */
async function alertStaff(clinicId: string, eventId: string): Promise<void> {
  try {
    const [clinic, staff] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } }),
      prisma.staff.findMany({ where: { clinicId, isActive: true, role: { in: ['ADMIN', 'DOCTOR'] } }, select: { phoneNumber: true } }),
    ]);
    const message = buildHealthEventAlertSms({ clinicName: clinic?.name ?? 'your clinic' });
    let sent = 0;
    for (const s of staff) if ((await sendSms(s.phoneNumber, message, 'PUBLIC_HEALTH_EVENT_ALERT')) === 'sent') sent++;
    await recordAuditEvent({
      actorType: 'SYSTEM',
      clinicId,
      action: 'PUBLIC_HEALTH_EVENT_ALERT_SENT',
      entityType: 'PublicHealthEvent',
      entityId: eventId,
      metadata: { recipients: staff.length, sent },
    });
  } catch (err) {
    logger.error({ err, eventId }, 'Public health event alert failed');
  }
}

export interface PublicHealthEventView {
  id: string;
  type: PublicHealthEventType;
  typeLabel: string;
  immediate: boolean;
  detectedOn: string;
  casesCount: number;
  casesUnder5: number;
  deathsCount: number;
  deathsUnder5: number;
  eventDescription: string;
  eventPlace: string | null;
  recordedBy: string;
  recordedAt: Date;
  reportedAt: Date | null;
  reportedBy: string | null;
  reportNote: string | null;
}

export async function listPublicHealthEvents(clinicId: string): Promise<PublicHealthEventView[]> {
  const rows = await prisma.publicHealthEvent.findMany({
    where: { clinicId },
    orderBy: [{ detectedOn: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: { recordedByStaff: { select: { name: true } }, reportedByStaff: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    typeLabel: EVENT_TYPES[r.type].label,
    immediate: EVENT_TYPES[r.type].immediate,
    detectedOn: r.detectedOn.toISOString().slice(0, 10),
    casesCount: r.casesCount,
    casesUnder5: r.casesUnder5,
    deathsCount: r.deathsCount,
    deathsUnder5: r.deathsUnder5,
    eventDescription: r.eventDescription,
    eventPlace: r.eventPlace,
    recordedBy: r.recordedByStaff.name,
    recordedAt: r.createdAt,
    reportedAt: r.reportedAt,
    reportedBy: r.reportedByStaff?.name ?? null,
    reportNote: r.reportNote,
  }));
}

export class EventNotFoundError extends Error {
  constructor() {
    super('Event not found');
  }
}

/** Confirms the event was reported to the Sub-County. Once only. */
export async function markEventReported(input: { eventId: string; clinicId: string; staffId: string; note?: string | null }): Promise<void> {
  const updated = await prisma.publicHealthEvent.updateMany({
    where: { id: input.eventId, clinicId: input.clinicId, reportedAt: null },
    data: { reportedAt: new Date(), reportedByStaffId: input.staffId, reportNote: input.note?.trim().slice(0, 500) || null },
  });
  if (updated.count === 0) {
    const exists = await prisma.publicHealthEvent.findFirst({ where: { id: input.eventId, clinicId: input.clinicId }, select: { id: true } });
    if (!exists) throw new EventNotFoundError();
    return;
  }
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'PUBLIC_HEALTH_EVENT_REPORTED',
    entityType: 'PublicHealthEvent',
    entityId: input.eventId,
  });
}

/** Immediately reportable events not yet marked reported (menu badge). */
export async function countUnreportedEvents(clinicId: string): Promise<number> {
  const immediate = (Object.keys(EVENT_TYPES) as PublicHealthEventType[]).filter((t) => EVENT_TYPES[t].immediate);
  return prisma.publicHealthEvent.count({ where: { clinicId, reportedAt: null, type: { in: immediate } } });
}

/** Events detected between two Kenya dates (inclusive start, exclusive end), for the weekly and routine reports. */
export async function eventsBetween(clinicId: string, fromDate: string, toDateExclusive: string) {
  return prisma.publicHealthEvent.findMany({
    where: { clinicId, detectedOn: { gte: new Date(`${fromDate}T00:00:00Z`), lt: new Date(`${toDateExclusive}T00:00:00Z`) } },
    select: { type: true, casesCount: true, casesUnder5: true, deathsCount: true, deathsUnder5: true },
  });
}
