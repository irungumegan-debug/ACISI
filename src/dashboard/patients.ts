import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { getScopedHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { z } from 'zod';

export const patientsRouter = Router();

patientsRouter.use(requireStaffSession);

/**
 * Search is scoped to patients who have a check-in or visit history at the
 * logged-in staff member's own clinic — not a global patient search. A
 * clinic shouldn't be able to browse patients it has no relationship with,
 * even though patient records are portable once a relationship exists.
 */
patientsRouter.get('/', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (query.length < 2) {
    res.json({ patients: [] });
    return;
  }

  const patients = await prisma.patient.findMany({
    where: {
      AND: [
        { OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] },
        {
          OR: [
            { phoneNumber: { contains: query } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    take: 20,
    orderBy: { firstName: 'asc' },
  });

  res.json({ patients });
});

patientsRouter.get('/:id', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const patientId = req.params.id;

  if (!patientId) {
    res.status(400).json({ error: 'Patient id is required' });
    return;
  }

  // Same authorization scoping as search: only patients with a relationship
  // to this clinic are visible, whether reached via search or a direct URL.
  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }],
    },
  });

  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  const { history, hasHiddenHistoryElsewhere } = await getScopedHistory(patient.id, clinicId);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'PATIENT_HISTORY_VIEWED',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { viewedByClinicId: clinicId, channel: 'DASHBOARD' },
  });

  res.json({
    id: patient.id,
    firstName: patient.firstName,
    lastName: patient.lastName,
    phoneNumber: patient.phoneNumber,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    smsOptOut: patient.smsOptOut,
    history,
    hasHiddenHistoryElsewhere,
  });
});

const smsPreferenceSchema = z.object({ smsOptOut: z.boolean() });

/**
 * "Patient does not want SMS" toggle on the patient's page — for patients
 * who checked in remotely (walk-ins can also set it at the front desk).
 * Front-desk roles only; scoped to patients this clinic has seen.
 */
patientsRouter.patch('/:id/sms-preference', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Only front-desk staff can change SMS preferences' });
    return;
  }
  const parsed = smsPreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'smsOptOut must be true or false' });
    return;
  }

  const patient = await prisma.patient.findFirst({
    where: { id: req.params.id, deletedAt: null, OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] },
  });
  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  await prisma.patient.update({
    where: { id: patient.id },
    data: { smsOptOut: parsed.data.smsOptOut, smsOptOutUpdatedAt: new Date() },
  });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: parsed.data.smsOptOut ? 'PATIENT_SMS_OPTED_OUT' : 'PATIENT_SMS_OPTED_IN',
    entityType: 'Patient',
    entityId: patient.id,
  });
  res.json({ smsOptOut: parsed.data.smsOptOut });
});
