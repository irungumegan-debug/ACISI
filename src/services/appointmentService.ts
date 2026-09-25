import dayjs from 'dayjs';
import { Appointment, AppointmentStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from './auditService';

/** Statuses from which an appointment can still be acted on — anything before its outcome is decided. */
const OPEN_STATUSES: AppointmentStatus[] = ['REQUESTED', 'CONFIRMED'];

export class AppointmentNotFoundError extends Error {
  constructor() {
    super('Appointment not found');
    this.name = 'AppointmentNotFoundError';
  }
}

/** Thrown when an appointment is already CANCELLED or COMPLETED — its outcome is decided and nothing else can happen to it. */
export class AppointmentNotActionableError extends Error {
  constructor() {
    super('This appointment has already been cancelled or completed');
    this.name = 'AppointmentNotActionableError';
  }
}

export class PastScheduledTimeError extends Error {
  constructor() {
    super('Please choose a date and time in the future');
    this.name = 'PastScheduledTimeError';
  }
}

interface RequestAppointmentInput {
  patientId: string;
  clinicId: string;
  departmentId: string;
  scheduledFor: Date;
}

/**
 * A patient's booking request via the web portal. Caller (the portal route)
 * is responsible for confirming clinicId/departmentId refer to a real, active
 * clinic/department first — same split of responsibility as
 * portalCheckinRouter's own check-in creation.
 */
export async function requestAppointment(input: RequestAppointmentInput): Promise<Appointment> {
  if (input.scheduledFor.getTime() <= Date.now()) {
    throw new PastScheduledTimeError();
  }

  const appointment = await prisma.appointment.create({
    data: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      departmentId: input.departmentId,
      scheduledFor: input.scheduledFor,
    },
  });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: input.patientId,
    action: 'APPOINTMENT_REQUESTED',
    entityType: 'Appointment',
    entityId: appointment.id,
    metadata: { clinicId: input.clinicId, departmentId: input.departmentId },
  });

  return appointment;
}

export interface OwnAppointmentListItem {
  id: string;
  clinicName: string;
  departmentName: string;
  scheduledFor: Date;
  status: AppointmentStatus;
}

/** The patient's own portal view — every clinic, soonest first. */
export async function listOwnAppointments(patientId: string): Promise<OwnAppointmentListItem[]> {
  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: { scheduledFor: 'asc' },
    include: { clinic: { select: { name: true } }, department: { select: { name: true } } },
  });

  return appointments.map((a) => ({
    id: a.id,
    clinicName: a.clinic.name,
    departmentName: a.department.name,
    scheduledFor: a.scheduledFor,
    status: a.status,
  }));
}

/**
 * A patient cancelling their own booking. Not-found covers both a bad id and
 * an appointment belonging to someone else, same not-found-vs-forbidden
 * pattern used throughout this codebase (e.g. staffService.StaffNotFoundError).
 */
export async function cancelOwnAppointment(patientId: string, appointmentId: string): Promise<Appointment> {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, patientId } });
  if (!appointment) {
    throw new AppointmentNotFoundError();
  }
  if (!OPEN_STATUSES.includes(appointment.status)) {
    throw new AppointmentNotActionableError();
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: 'CANCELLED', cancelledByType: 'PATIENT', cancelledAt: new Date() },
  });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    action: 'APPOINTMENT_CANCELLED',
    entityType: 'Appointment',
    entityId: appointment.id,
  });

  return updated;
}

export interface ClinicAppointmentListItem {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  phoneNumber: string;
  departmentName: string;
  scheduledFor: Date;
  status: AppointmentStatus;
}

/** Staff-facing view: this clinic's appointments from today onward, across all departments, soonest first. */
export async function listClinicAppointments(clinicId: string): Promise<ClinicAppointmentListItem[]> {
  const startOfToday = dayjs().startOf('day').toDate();

  const appointments = await prisma.appointment.findMany({
    where: { clinicId, scheduledFor: { gte: startOfToday } },
    orderBy: { scheduledFor: 'asc' },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, patientCode: true, phoneNumber: true } },
      department: { select: { name: true } },
    },
  });

  return appointments.map((a) => ({
    id: a.id,
    patientId: a.patient.id,
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    patientCode: a.patient.patientCode,
    phoneNumber: a.patient.phoneNumber,
    departmentName: a.department.name,
    scheduledFor: a.scheduledFor,
    status: a.status,
  }));
}

interface StaffActionInput {
  clinicId: string;
  appointmentId: string;
  staffId: string;
}

/** Clinic-scoped lookup shared by confirm/cancel — not-found covers both a bad id and a cross-clinic attempt. */
async function findClinicAppointmentOrThrow(clinicId: string, appointmentId: string): Promise<Appointment> {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, clinicId } });
  if (!appointment) {
    throw new AppointmentNotFoundError();
  }
  return appointment;
}

/** A clinic admin/staff member confirming a REQUESTED booking. */
export async function confirmAppointment(input: StaffActionInput): Promise<Appointment> {
  const appointment = await findClinicAppointmentOrThrow(input.clinicId, input.appointmentId);
  if (appointment.status !== 'REQUESTED') {
    throw new AppointmentNotActionableError();
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: 'CONFIRMED', confirmedByStaffId: input.staffId, confirmedAt: new Date() },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'APPOINTMENT_CONFIRMED',
    entityType: 'Appointment',
    entityId: appointment.id,
  });

  return updated;
}

/** A clinic admin/staff member cancelling a booking, from either REQUESTED or CONFIRMED. */
export async function cancelAppointmentByStaff(input: StaffActionInput): Promise<Appointment> {
  const appointment = await findClinicAppointmentOrThrow(input.clinicId, input.appointmentId);
  if (!OPEN_STATUSES.includes(appointment.status)) {
    throw new AppointmentNotActionableError();
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: 'CANCELLED', cancelledByType: 'STAFF', cancelledByStaffId: input.staffId, cancelledAt: new Date() },
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'APPOINTMENT_CANCELLED',
    entityType: 'Appointment',
    entityId: appointment.id,
  });

  return updated;
}

export interface DepartmentAppointmentListItem {
  id: string;
  patientName: string;
  patientCode: string;
  scheduledFor: Date;
}

/** A doctor's own read-only view: today's CONFIRMED appointments in their department, soonest first. */
export async function listDepartmentAppointmentsToday(clinicId: string, departmentId: string): Promise<DepartmentAppointmentListItem[]> {
  const startOfToday = dayjs().startOf('day').toDate();
  const startOfTomorrow = dayjs().add(1, 'day').startOf('day').toDate();

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      departmentId,
      status: 'CONFIRMED',
      scheduledFor: { gte: startOfToday, lt: startOfTomorrow },
    },
    orderBy: { scheduledFor: 'asc' },
    include: { patient: { select: { firstName: true, lastName: true, patientCode: true } } },
  });

  return appointments.map((a) => ({
    id: a.id,
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    patientCode: a.patient.patientCode,
    scheduledFor: a.scheduledFor,
  }));
}

/**
 * Looks for a same-day booking this arrival could fulfill — called from
 * checkInService.initiateCheckIn for every new CheckIn, regardless of
 * channel (USSD, web portal, or staff), so a booked patient never needs
 * manual reconciliation however they actually show up. Matches REQUESTED or
 * CONFIRMED (arriving in person is itself strong evidence of intent, even
 * before staff got around to confirming) for the same patient/clinic/
 * department, scheduled today. Earliest match wins on the rare chance of
 * more than one.
 */
export async function findArrivalMatch(patientId: string, clinicId: string, departmentId: string): Promise<Appointment | null> {
  const startOfToday = dayjs().startOf('day').toDate();
  const startOfTomorrow = dayjs().add(1, 'day').startOf('day').toDate();

  return prisma.appointment.findFirst({
    where: {
      patientId,
      clinicId,
      departmentId,
      status: { in: OPEN_STATUSES },
      scheduledFor: { gte: startOfToday, lt: startOfTomorrow },
    },
    orderBy: { scheduledFor: 'asc' },
  });
}

/** Internal: flips a matched appointment to COMPLETED once its CheckIn exists. No status guard — callers only ever reach here via a match that was already confirmed open. */
export async function markAppointmentCompleted(appointmentId: string): Promise<void> {
  await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'COMPLETED' } });
}

export interface AppointmentForArrival {
  id: string;
  patientId: string;
  clinicId: string;
  clinicName: string;
  departmentId: string;
  phoneNumberE164: string;
}

/**
 * Staff explicitly checking a booked patient in (as opposed to the patient
 * arriving and checking in themselves). Clinic-scoped like the other staff
 * actions; only valid from an open status, same as confirm/cancel.
 */
export async function getAppointmentForArrival(appointmentId: string, clinicId: string): Promise<AppointmentForArrival> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    include: { patient: { select: { phoneNumber: true } }, clinic: { select: { name: true } } },
  });
  if (!appointment) {
    throw new AppointmentNotFoundError();
  }
  if (!OPEN_STATUSES.includes(appointment.status)) {
    throw new AppointmentNotActionableError();
  }

  return {
    id: appointment.id,
    patientId: appointment.patientId,
    clinicId: appointment.clinicId,
    clinicName: appointment.clinic.name,
    departmentId: appointment.departmentId,
    phoneNumberE164: appointment.patient.phoneNumber,
  };
}
