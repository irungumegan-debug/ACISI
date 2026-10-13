import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { getScopedHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { z } from 'zod';
import { clinicCanSeePatientWhere } from '../services/clinicPatientService';
import {
  approveRecordAccessWithCode,
  approveRecordAccessWithPin,
  RecordAccessError,
  recordAccessStatus,
  requestRecordAccess,
} from '../services/recordAccessService';
import { identityView, patientIdentityInputSchema, PatientIdentityError, preparePatientIdentity } from '../services/patientIdentity';

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
        clinicCanSeePatientWhere(clinicId),
        {
          OR: [
            { phoneNumber: { contains: query } },
            { patientCode: { equals: query.toUpperCase() } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true, patientCode: true },
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
      ...clinicCanSeePatientWhere(clinicId),
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
    clinicId,
    patientId: patient.id,
    action: 'PATIENT_HISTORY_VIEWED',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: {
      viewedByClinicId: clinicId,
      channel: 'DASHBOARD',
      // Whether records from other clinics were part of this view (only with the patient's approval).
      includesOtherClinics: history.some((h) => !h.isOwnClinic),
    },
  });

  res.json({
    id: patient.id,
    patientCode: patient.patientCode,
    firstName: patient.firstName,
    lastName: patient.lastName,
    phoneNumber: patient.phoneNumber,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    smsOptOut: patient.smsOptOut,
    ...identityView(patient),
    history,
    hasHiddenHistoryElsewhere,
    recordAccess: hasHiddenHistoryElsewhere ? await recordAccessStatus(patient.id, clinicId) : null,
  });
});

function sendRecordAccessError(err: unknown, res: import('express').Response): boolean {
  if (err instanceof RecordAccessError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * "Request past records": texts the patient a code to read out at the desk.
 * Front-desk roles only (the patient is standing there); the clinic and
 * staff member always come from the session.
 */
patientsRouter.post('/:id/record-access/request', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Ask the front desk to request past records' });
    return;
  }
  try {
    res.json(await requestRecordAccess(clinicId, staffId, req.params.id as string));
  } catch (err) {
    if (!sendRecordAccessError(err, res)) throw err;
  }
});

const approveSchema = z.union([z.object({ code: z.string().trim().min(1).max(10) }), z.object({ pin: z.string().min(1).max(12) })]);

/** The code the patient read out, or the patient's own PIN typed on this screen. */
patientsRouter.post('/:id/record-access/approve', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Ask the front desk to request past records' });
    return;
  }
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter the code from the SMS, or let the patient type their PIN' });
    return;
  }
  try {
    if ('code' in parsed.data) await approveRecordAccessWithCode(clinicId, staffId, req.params.id as string, parsed.data.code);
    else await approveRecordAccessWithPin(clinicId, staffId, req.params.id as string, parsed.data.pin);
    res.status(204).send();
  } catch (err) {
    if (!sendRecordAccessError(err, res)) throw err;
  }
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
    where: { id: req.params.id, deletedAt: null, ...clinicCanSeePatientWhere(clinicId) },
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

/**
 * ID document and next of kin on the patient's page. Front-desk roles only;
 * scoped to patients this clinic has seen. Fields sent empty are cleared.
 * The audit row names which fields changed, never their values.
 */
patientsRouter.patch('/:id/details', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Only front-desk staff can change patient details' });
    return;
  }
  const parsed = patientIdentityInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the ID and next of kin details' });
    return;
  }

  let update;
  try {
    update = preparePatientIdentity(parsed.data, 'replace');
  } catch (err) {
    if (err instanceof PatientIdentityError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const patient = await prisma.patient.findFirst({
    where: { id: req.params.id, deletedAt: null, ...clinicCanSeePatientWhere(clinicId) },
  });
  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  const updated = await prisma.patient.update({ where: { id: patient.id }, data: update });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'PATIENT_DETAILS_UPDATED',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { fields: Object.keys(update), clinicId },
  });
  res.json(identityView(updated));
});
