import { LabOrderStatus, LabResultFlag, Prisma, Sex } from '@prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { doctorQueueFilter } from './doctorScope';
import { publishQueueChanged } from './realtimeEvents';
import { verifySigningPin } from './signingPin';
import { sendPatientSms } from './smsService';
import { buildLabResultsReadySms } from './smsTemplates';

/**
 * Lab orders: a doctor requests tests during a consultation, the patient
 * moves to the clinic's lab queue, a lab technician enters and signs the
 * results, the patient gets one SMS ("results ready, go back to the
 * doctor"), and the visit returns to the requesting doctor's queue.
 *
 * Who sees what:
 * - Doctor: everything for visits in their own queue (doctorQueueFilter).
 * - Lab technician: only open lab orders at their clinic, with the patient's
 *   name, ACISI ID, age and sex, the tests and the doctor's note for the lab.
 *   Never the diagnosis, prescription, history, phone number or billing.
 * - Front desk: test names and prices (for the bill); full results only on
 *   the printed visit record, like diagnoses.
 * - Patient: their own results, once the visit is checked out.
 * Every request, open, save, sign and SMS is audit-logged with IDs only.
 */

export const MAX_TESTS_PER_ORDER = 30;
export const MAX_LAB_TEST_PRICE_KES = 1_000_000;
export const LAB_TEST_NAME_MAX = 80;
export const LAB_NOTE_MAX = 500;
export const RESULT_VALUE_MAX = 200;
export const RESULT_UNIT_MAX = 30;
export const RESULT_COMMENT_MAX = 500;

export class LabError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'LabError';
  }
}

const OPEN_STATUSES: LabOrderStatus[] = ['REQUESTED', 'IN_PROGRESS'];

// --- The clinic's test list (admin) ------------------------------------------

export interface LabTestItem {
  id: string;
  name: string;
  priceKes: number;
  isActive: boolean;
}

function cleanTestName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function checkPrice(priceKes: number): void {
  if (!Number.isInteger(priceKes) || priceKes < 0 || priceKes > MAX_LAB_TEST_PRICE_KES) {
    throw new LabError('Enter the price in whole shillings');
  }
}

export async function listLabTests(clinicId: string, options: { includeInactive?: boolean } = {}): Promise<LabTestItem[]> {
  const rows = await prisma.labTest.findMany({
    where: { clinicId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return rows.map((t) => ({ id: t.id, name: t.name, priceKes: t.priceKes, isActive: t.isActive }));
}

export async function createLabTest(input: { clinicId: string; staffId: string; name: string; priceKes: number }): Promise<LabTestItem> {
  const name = cleanTestName(input.name);
  if (name.length < 2 || name.length > LAB_TEST_NAME_MAX) throw new LabError(`Enter a test name (2 to ${LAB_TEST_NAME_MAX} characters)`);
  checkPrice(input.priceKes);
  try {
    const row = await prisma.labTest.create({ data: { clinicId: input.clinicId, name, nameKey: name.toLowerCase(), priceKes: input.priceKes } });
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'LAB_TEST_CREATED',
      entityType: 'LabTest',
      entityId: row.id,
      metadata: { priceKes: row.priceKes },
    });
    return { id: row.id, name: row.name, priceKes: row.priceKes, isActive: row.isActive };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new LabError('Your clinic already has a test with that name', 409);
    throw err;
  }
}

export async function updateLabTest(input: {
  clinicId: string;
  staffId: string;
  labTestId: string;
  name?: string;
  priceKes?: number;
  isActive?: boolean;
}): Promise<LabTestItem> {
  const existing = await prisma.labTest.findFirst({ where: { id: input.labTestId, clinicId: input.clinicId } });
  if (!existing) throw new LabError('Test not found', 404);
  const data: Prisma.LabTestUpdateInput = {};
  if (input.name !== undefined) {
    const name = cleanTestName(input.name);
    if (name.length < 2 || name.length > LAB_TEST_NAME_MAX) throw new LabError(`Enter a test name (2 to ${LAB_TEST_NAME_MAX} characters)`);
    data.name = name;
    data.nameKey = name.toLowerCase();
  }
  if (input.priceKes !== undefined) {
    checkPrice(input.priceKes);
    data.priceKes = input.priceKes;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  try {
    const row = await prisma.labTest.update({ where: { id: existing.id }, data });
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: input.staffId,
      staffId: input.staffId,
      clinicId: input.clinicId,
      action: 'LAB_TEST_UPDATED',
      entityType: 'LabTest',
      entityId: row.id,
      metadata: { priceKes: row.priceKes, isActive: row.isActive, labelChanged: input.name !== undefined && row.name !== existing.name },
    });
    return { id: row.id, name: row.name, priceKes: row.priceKes, isActive: row.isActive };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new LabError('Your clinic already has a test with that name', 409);
    throw err;
  }
}

// --- Doctor: request tests -----------------------------------------------------

export interface RequestLabTestsInput {
  encounterId: string;
  clinicId: string;
  departmentIds: string[];
  staffId: string;
  labTestIds: string[];
  noteForLab?: string | null;
  /** The doctor's own PIN, re-entered as the act of requesting. */
  pin: string;
}

/**
 * The doctor requests one or more of the clinic's tests for a visit that is
 * with them now (IN_CONSULTATION, in their own queue). The visit moves to
 * AWAITING_LAB, so it leaves the doctor's queue and appears in the lab
 * queue. Nothing is saved unless the doctor's PIN is right.
 */
export async function requestLabTests(input: RequestLabTestsInput): Promise<{ labOrderId: string }> {
  const encounter = await prisma.encounter.findFirst({
    where: { id: input.encounterId, ...doctorQueueFilter(input.clinicId, input.departmentIds, input.staffId) },
    select: { id: true, status: true, checkInId: true },
  });
  if (!encounter) throw new LabError('Patient not found in your queue', 404);
  if (encounter.status !== 'IN_CONSULTATION') throw new LabError('Open the patient before requesting lab tests', 409);

  const ids = [...new Set(input.labTestIds)];
  if (ids.length === 0) throw new LabError('Choose at least one test');
  if (ids.length > MAX_TESTS_PER_ORDER) throw new LabError(`At most ${MAX_TESTS_PER_ORDER} tests at a time`);
  const note = input.noteForLab?.trim() || null;
  if (note && note.length > LAB_NOTE_MAX) throw new LabError(`Keep the note for the lab under ${LAB_NOTE_MAX} characters`);

  const tests = await prisma.labTest.findMany({ where: { id: { in: ids }, clinicId: input.clinicId, isActive: true } });
  if (tests.length !== ids.length) throw new LabError('One of those tests is not on your clinic’s list any more. Refresh and try again.');
  const byId = new Map(tests.map((t) => [t.id, t]));

  await verifySigningPin({
    staffId: input.staffId,
    pin: input.pin,
    clinicId: input.clinicId,
    okAction: 'LAB_ORDER_SIGNED',
    failedAction: 'LAB_ORDER_SIGN_FAILED',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  const order = await prisma.$transaction(async (tx) => {
    // Conditional: two clicks (or two tabs) can't send the patient twice.
    const moved = await tx.encounter.updateMany({ where: { id: encounter.id, status: 'IN_CONSULTATION' }, data: { status: 'AWAITING_LAB' } });
    if (moved.count === 0) throw new LabError('This patient is no longer with you', 409);
    return tx.labOrder.create({
      data: {
        encounterId: encounter.id,
        clinicId: input.clinicId,
        requestedByStaffId: input.staffId,
        noteForLab: note,
        items: {
          create: ids.map((id, position) => {
            const t = byId.get(id)!;
            return { labTestId: t.id, testName: t.name, priceKes: t.priceKes, position };
          }),
        },
      },
    });
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'LAB_ORDER_REQUESTED',
    entityType: 'LabOrder',
    entityId: order.id,
    metadata: { encounterId: encounter.id, testCount: ids.length },
  });
  publishQueueChanged({ checkInId: encounter.checkInId, clinicId: input.clinicId });
  return { labOrderId: order.id };
}

// --- What each role sees --------------------------------------------------------

export interface LabOrderItemView {
  id: string;
  testName: string;
  resultValue: string | null;
  resultUnit: string | null;
  resultFlag: LabResultFlag | null;
  resultComment: string | null;
}

export interface LabOrderView {
  id: string;
  status: LabOrderStatus;
  requestedAt: Date;
  requestedByName: string;
  noteForLab: string | null;
  completedAt: Date | null;
  completedByName: string | null;
  patientNotifiedAt: Date | null;
  items: LabOrderItemView[];
  files: { id: string; categoryLabel: string; mimeType: string; uploadedAt: Date }[];
}

const orderInclude = {
  items: { orderBy: { position: 'asc' } },
  requestedByStaff: { select: { name: true } },
  completedByStaff: { select: { name: true } },
  files: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.LabOrderInclude;

type OrderWithIncludes = Prisma.LabOrderGetPayload<{ include: typeof orderInclude }>;

function toOrderView(o: OrderWithIncludes, options: { withResults: boolean }): LabOrderView {
  return {
    id: o.id,
    status: o.status,
    requestedAt: o.requestedAt,
    requestedByName: o.requestedByStaff.name,
    noteForLab: o.noteForLab,
    completedAt: o.completedAt,
    completedByName: o.completedByStaff?.name ?? null,
    patientNotifiedAt: o.patientNotifiedAt,
    items: o.items.map((i) => ({
      id: i.id,
      testName: i.testName,
      resultValue: options.withResults ? i.resultValue : null,
      resultUnit: options.withResults ? i.resultUnit : null,
      resultFlag: options.withResults ? i.resultFlag : null,
      resultComment: options.withResults ? i.resultComment : null,
    })),
    files: options.withResults ? o.files.map((f) => ({ id: f.id, categoryLabel: 'Lab report', mimeType: f.mimeType, uploadedAt: f.createdAt })) : [],
  };
}

/** Every lab order of a visit, for the doctor's consultation page (results once signed). */
export async function getLabOrdersForEncounter(encounterId: string): Promise<LabOrderView[]> {
  const orders = await prisma.labOrder.findMany({ where: { encounterId }, orderBy: { requestedAt: 'asc' }, include: orderInclude });
  return orders.map((o) => toOrderView(o, { withResults: o.status === 'RESULTS_READY' }));
}

/** Test names and prices of a visit's lab orders, for front desk's bill. No results. */
export async function getLabChargesForEncounter(encounterId: string): Promise<{ testName: string; priceKes: number }[]> {
  const items = await prisma.labOrderItem.findMany({
    where: { labOrder: { encounterId } },
    orderBy: [{ labOrder: { requestedAt: 'asc' } }, { position: 'asc' }],
    select: { testName: true, priceKes: true },
  });
  return items;
}

/** Signed results of a visit (for the patient's own records and the printed visit record). */
export async function getSignedLabResults(encounterId: string): Promise<LabOrderView[]> {
  const orders = await prisma.labOrder.findMany({
    where: { encounterId, status: 'RESULTS_READY' },
    orderBy: { requestedAt: 'asc' },
    include: orderInclude,
  });
  return orders.map((o) => toOrderView(o, { withResults: true }));
}

// --- Lab technician ---------------------------------------------------------------

/** Whole years from date of birth, or null. */
export function ageInYears(dateOfBirth: Date | null, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age--;
  return age >= 0 ? age : null;
}

export interface LabQueueItem {
  labOrderId: string;
  status: LabOrderStatus;
  requestedAt: Date;
  requestedByName: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: Sex;
  testNames: string[];
}

/** The clinic's open lab orders, oldest first. Only what the lab needs: no phone, no diagnosis. */
export async function getLabQueue(clinicId: string): Promise<LabQueueItem[]> {
  const orders = await prisma.labOrder.findMany({
    where: { clinicId, status: { in: OPEN_STATUSES } },
    orderBy: { requestedAt: 'asc' },
    include: {
      items: { orderBy: { position: 'asc' }, select: { testName: true } },
      requestedByStaff: { select: { name: true } },
      encounter: { select: { patient: { select: { firstName: true, lastName: true, patientCode: true, dateOfBirth: true, sex: true } } } },
    },
  });
  return orders.map((o) => ({
    labOrderId: o.id,
    status: o.status,
    requestedAt: o.requestedAt,
    requestedByName: o.requestedByStaff.name,
    patientName: `${o.encounter.patient.firstName} ${o.encounter.patient.lastName}`.trim(),
    patientCode: o.encounter.patient.patientCode,
    age: ageInYears(o.encounter.patient.dateOfBirth),
    sex: o.encounter.patient.sex,
    testNames: o.items.map((i) => i.testName),
  }));
}

export interface LabOrderDetailForLab extends LabOrderView {
  patientId: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  sex: Sex;
}

async function findOpenOrder(labOrderId: string, clinicId: string) {
  const order = await prisma.labOrder.findFirst({
    where: { id: labOrderId, clinicId, status: { in: OPEN_STATUSES } },
    include: { ...orderInclude, encounter: { select: { patientId: true, patient: { select: { firstName: true, lastName: true, patientCode: true, dateOfBirth: true, sex: true } } } } },
  });
  if (!order) throw new LabError('Lab request not found, or its results are already done', 404);
  return order;
}

/**
 * A lab technician opening a request from the lab queue. The first opening
 * marks it IN_PROGRESS with who and when. Every opening is audit-logged.
 */
export async function openLabOrder(labOrderId: string, clinicId: string, staffId: string): Promise<LabOrderDetailForLab> {
  const order = await findOpenOrder(labOrderId, clinicId);
  if (order.status === 'REQUESTED') {
    await prisma.labOrder.updateMany({ where: { id: order.id, status: 'REQUESTED' }, data: { status: 'IN_PROGRESS', startedByStaffId: staffId, startedAt: new Date() } });
    order.status = 'IN_PROGRESS';
  }
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'LAB_ORDER_OPENED',
    entityType: 'LabOrder',
    entityId: order.id,
    metadata: { patientId: order.encounter.patientId },
  });
  const p = order.encounter.patient;
  return {
    ...toOrderView(order, { withResults: true }),
    patientId: order.encounter.patientId,
    patientName: `${p.firstName} ${p.lastName}`.trim(),
    patientCode: p.patientCode,
    age: ageInYears(p.dateOfBirth),
    sex: p.sex,
  };
}

export interface LabResultInput {
  itemId: string;
  value?: string | null;
  unit?: string | null;
  flag?: LabResultFlag | null;
  comment?: string | null;
}

function clean(v: string | null | undefined, max: number, label: string): string | null {
  const t = v?.trim() || null;
  if (t && t.length > max) throw new LabError(`Keep the ${label} under ${max} characters`);
  return t;
}

/** Saves typed results (a draft until signed). Only items of this order; empty fields clear. */
export async function saveLabResults(input: { labOrderId: string; clinicId: string; staffId: string; results: LabResultInput[] }): Promise<void> {
  const order = await findOpenOrder(input.labOrderId, input.clinicId);
  const itemIds = new Set(order.items.map((i) => i.id));
  for (const r of input.results) {
    if (!itemIds.has(r.itemId)) throw new LabError('That result is not part of this lab request');
  }
  const updates = input.results.map((r) => ({
    id: r.itemId,
    data: {
      resultValue: clean(r.value, RESULT_VALUE_MAX, 'result'),
      resultUnit: clean(r.unit, RESULT_UNIT_MAX, 'unit'),
      resultFlag: r.flag ?? null,
      resultComment: clean(r.comment, RESULT_COMMENT_MAX, 'comment'),
    },
  }));
  await prisma.$transaction(updates.map((u) => prisma.labOrderItem.update({ where: { id: u.id }, data: u.data })));
  if (order.status === 'REQUESTED') {
    await prisma.labOrder.updateMany({ where: { id: order.id, status: 'REQUESTED' }, data: { status: 'IN_PROGRESS', startedByStaffId: input.staffId, startedAt: new Date() } });
  }
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'LAB_RESULTS_SAVED',
    entityType: 'LabOrder',
    entityId: order.id,
    metadata: { itemCount: updates.length },
  });
}

export type LabSmsOutcome = 'sent' | 'opted_out' | 'failed';

/**
 * The lab technician signs the results (PIN re-entered). Every test needs a
 * result or a flag. The order becomes RESULTS_READY; when the visit has no
 * other open lab orders it goes back to WAITING, still assigned to the
 * requesting doctor, and the patient gets one SMS. Returns the SMS outcome.
 */
export async function completeLabOrder(input: { labOrderId: string; clinicId: string; staffId: string; pin: string }): Promise<{ sms: LabSmsOutcome | 'not_sent_yet' }> {
  const order = await findOpenOrder(input.labOrderId, input.clinicId);
  const missing = order.items.filter((i) => !i.resultValue && !i.resultFlag);
  if (missing.length > 0) {
    throw new LabError(`Enter a result for every test first (${missing.map((i) => i.testName).join(', ')})`);
  }

  await verifySigningPin({
    staffId: input.staffId,
    pin: input.pin,
    clinicId: input.clinicId,
    okAction: 'LAB_RESULTS_SIGNED',
    failedAction: 'LAB_RESULTS_SIGN_FAILED',
    entityType: 'LabOrder',
    entityId: order.id,
  });

  const backToDoctor = await prisma.$transaction(async (tx) => {
    const done = await tx.labOrder.updateMany({
      where: { id: order.id, status: { in: OPEN_STATUSES } },
      data: { status: 'RESULTS_READY', completedByStaffId: input.staffId, completedAt: new Date() },
    });
    if (done.count === 0) throw new LabError('These results were already signed', 409);
    const stillOpen = await tx.labOrder.count({ where: { encounterId: order.encounterId, status: { in: OPEN_STATUSES } } });
    if (stillOpen > 0) return false;
    const moved = await tx.encounter.updateMany({ where: { id: order.encounterId, status: 'AWAITING_LAB' }, data: { status: 'WAITING' } });
    return moved.count > 0;
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: 'LAB_RESULTS_COMPLETED',
    entityType: 'LabOrder',
    entityId: order.id,
    metadata: { encounterId: order.encounterId, backToDoctor },
  });

  const encounter = await prisma.encounter.findUnique({ where: { id: order.encounterId }, select: { checkInId: true } });
  if (encounter) publishQueueChanged({ checkInId: encounter.checkInId, clinicId: input.clinicId });

  if (!backToDoctor) return { sms: 'not_sent_yet' };
  return { sms: await sendLabResultsReadySms(order.id) };
}

/**
 * One SMS to the patient: "your lab results at <clinic> are ready, please go
 * back to the doctor". Never the tests or results. Respects "does not want
 * SMS"; counted against the clinic's SMS allowance. Never throws.
 */
export async function sendLabResultsReadySms(labOrderId: string): Promise<LabSmsOutcome> {
  try {
    const order = await prisma.labOrder.findUniqueOrThrow({
      where: { id: labOrderId },
      select: {
        id: true,
        clinicId: true,
        clinic: { select: { name: true } },
        encounter: { select: { patient: { select: { phoneNumber: true, smsOptOut: true, deletedAt: true } } } },
      },
    });
    const outcome = await sendPatientSms(order.encounter.patient, buildLabResultsReadySms({ clinicName: order.clinic.name }), {
      purpose: 'LAB_RESULTS_READY',
      clinicId: order.clinicId,
    });
    if (outcome === 'sent') {
      await prisma.labOrder.update({ where: { id: order.id }, data: { patientNotifiedAt: new Date() } });
    }
    await recordAuditEvent({
      actorType: 'SYSTEM',
      action: outcome === 'sent' ? 'LAB_RESULTS_SMS_SENT' : outcome === 'failed' ? 'LAB_RESULTS_SMS_FAILED' : 'LAB_RESULTS_SMS_SKIPPED_OPT_OUT',
      entityType: 'LabOrder',
      entityId: order.id,
      clinicId: order.clinicId,
    });
    return outcome === 'sent' ? 'sent' : outcome === 'failed' ? 'failed' : 'opted_out';
  } catch (err) {
    logger.error({ err, labOrderId }, 'Failed to send lab results SMS');
    return 'failed';
  }
}

/** The patient of an open lab order at this clinic, for the lab's file uploads. */
export async function patientOfOpenOrder(labOrderId: string, clinicId: string): Promise<string> {
  const order = await findOpenOrder(labOrderId, clinicId);
  return order.encounter.patientId;
}
