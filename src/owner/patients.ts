import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { deletePatientAccount, PatientNotFoundError } from '../services/patientDeletionService';
import { toE164 } from '../utils/phone';
import { AuthenticatedOwnerRequest } from './auth';
import { describeAuditLogs } from './activity';

export const ownerPatientsRouter = Router();

const LIST_LIMIT = 50;

/**
 * Searches every patient on the platform — unlike the staff dashboard's
 * search, not scoped to any one clinic. With no query, lists the most
 * recently registered. Names and contact details only; clinical detail is
 * behind GET /:id, which is audit-logged.
 */
ownerPatientsRouter.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = req.query.status === 'deleted' || req.query.status === 'all' ? req.query.status : 'active';

  const where: Prisma.PatientWhereInput = {};
  if (status === 'active') where.deletedAt = null;
  if (status === 'deleted') where.deletedAt = { not: null };

  if (query) {
    const or: Prisma.PatientWhereInput[] = [
      { firstName: { contains: query, mode: 'insensitive' } },
      { lastName: { contains: query, mode: 'insensitive' } },
      { patientCode: { contains: query, mode: 'insensitive' } },
      { phoneNumber: { contains: query } },
      { email: { contains: query, mode: 'insensitive' } },
    ];
    // "0712 345 678" should find "+254712345678".
    try {
      or.push({ phoneNumber: toE164(query) });
    } catch {
      // Not a phone number — the other matches still apply.
    }
    where.OR = or;
  }

  const patients = await prisma.patient.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
    include: { _count: { select: { encounters: true } } },
  });

  res.json({
    patients: patients.map((p) => ({
      id: p.id,
      patientCode: p.patientCode,
      firstName: p.firstName,
      lastName: p.lastName,
      phoneNumber: p.deletedAt ? null : p.phoneNumber,
      createdAt: p.createdAt,
      deletedAt: p.deletedAt,
      visitCount: p._count.encounters,
    })),
  });
});

/** A patient's complete record across every clinic. Every view is written to the audit log. */
ownerPatientsRouter.get('/:id', async (req, res) => {
  const { ownerId } = (req as unknown as AuthenticatedOwnerRequest).ownerSession;

  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: {
      consents: { orderBy: { createdAt: 'desc' } },
      encounters: {
        orderBy: { createdAt: 'desc' },
        include: {
          clinic: { select: { id: true, name: true } },
          assignedDoctor: { select: { name: true } },
          consultedByStaff: { select: { name: true } },
          checkIn: {
            select: {
              amountKes: true,
              status: true,
              paidAt: true,
              department: { select: { name: true } },
              mpesaTransactions: { select: { mpesaReceiptNumber: true }, where: { mpesaReceiptNumber: { not: null } } },
            },
          },
        },
      },
      appointments: {
        orderBy: { scheduledFor: 'desc' },
        include: { clinic: { select: { name: true } }, department: { select: { name: true } } },
      },
    },
  });

  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  // Logged before the access history is read, so this very view shows up in it.
  await recordAuditEvent({
    actorType: 'OWNER',
    actorId: ownerId,
    action: 'OWNER_PATIENT_RECORD_VIEWED',
    entityType: 'Patient',
    entityId: patient.id,
  });

  const accessLog = await prisma.auditLog.findMany({
    where: { entityType: 'Patient', entityId: patient.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const latestConsent = (type: 'PLATFORM_REGISTRATION' | 'CROSS_CLINIC_RECORD_SHARING') =>
    patient.consents.find((c) => c.type === type)?.granted ?? false;

  res.json({
    id: patient.id,
    patientCode: patient.patientCode,
    firstName: patient.firstName,
    lastName: patient.lastName,
    phoneNumber: patient.deletedAt ? null : patient.phoneNumber,
    email: patient.email,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    county: patient.county,
    hasPin: patient.pinHash !== null,
    createdAt: patient.createdAt,
    deletedAt: patient.deletedAt,
    deletedByType: patient.deletedByType,
    crossClinicSharing: latestConsent('CROSS_CLINIC_RECORD_SHARING'),
    consents: patient.consents.map((c) => ({
      id: c.id,
      type: c.type,
      granted: c.granted,
      channel: c.channel,
      version: c.version,
      createdAt: c.createdAt,
    })),
    visits: patient.encounters.map((e) => ({
      encounterId: e.id,
      clinicId: e.clinic.id,
      clinicName: e.clinic.name,
      departmentName: e.checkIn.department.name,
      status: e.status,
      assignedDoctorName: e.assignedDoctor?.name ?? null,
      consultedByName: e.consultedByStaff?.name ?? null,
      visitReason: e.visitReason,
      diagnosis: e.diagnosis,
      prescription: e.prescription,
      amountKes: Number(e.checkIn.amountKes),
      paymentStatus: e.checkIn.status,
      mpesaReceiptNumber: e.checkIn.mpesaTransactions[0]?.mpesaReceiptNumber ?? null,
      visitedAt: e.createdAt,
      checkedOutAt: e.checkedOutAt,
    })),
    appointments: patient.appointments.map((a) => ({
      id: a.id,
      clinicName: a.clinic.name,
      departmentName: a.department.name,
      scheduledFor: a.scheduledFor,
      status: a.status,
      createdAt: a.createdAt,
    })),
    accessLog: await describeAuditLogs(accessLog),
  });
});

const deleteSchema = z.object({ confirmPatientCode: z.string().min(1) });

/**
 * Deletes a patient account (see patientDeletionService for exactly what's
 * wiped and what's kept). Requires the patient's code to be typed back as
 * confirmation, so a stray click or replayed request can't delete the wrong
 * person.
 */
ownerPatientsRouter.post('/:id/delete', async (req, res) => {
  const { ownerId } = (req as unknown as AuthenticatedOwnerRequest).ownerSession;
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Type the patient's ID to confirm" });
    return;
  }

  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient || patient.deletedAt) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  if (parsed.data.confirmPatientCode.trim().toUpperCase() !== patient.patientCode) {
    res.status(400).json({ error: "The patient ID you typed doesn't match" });
    return;
  }

  try {
    await deletePatientAccount(patient.id, { type: 'OWNER', ownerId });
  } catch (err) {
    if (err instanceof PatientNotFoundError) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    throw err;
  }

  res.status(204).send();
});
