import { Response, Router } from 'express';
import { enterRecordAccessCode, RecordSharingError, requestRecords } from '../services/recordSharingService';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { doctorQueueFilter } from '../services/doctorScope';
import { getDoctorDepartmentIds } from '../services/departmentService';
import { buildVisitRecordDataFromEncounter, renderVisitRecordPdf } from '../services/visitRecordDocument';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { getScopedHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { z } from 'zod';
import { identityView, patientIdentityInputSchema, PatientIdentityError, preparePatientIdentity } from '../services/patientIdentity';

export const patientsRouter = Router();

patientsRouter.use(requireStaffSession);

/**
 * Which patients a staff member may see. Front desk: anyone with a check-in
 * or visit at this clinic. A doctor: only patients currently in their own
 * queue (doctorQueueFilter) — enforced here on the server, not just by
 * hiding the menu item.
 */
async function visibleToStaffWhere(req: AuthenticatedRequest): Promise<Prisma.PatientWhereInput> {
  const { clinicId, role, staffId } = req.dashboardSession;
  if (role === 'DOCTOR') {
    const departmentIds = await getDoctorDepartmentIds(staffId);
    return { encounters: { some: doctorQueueFilter(clinicId, departmentIds, staffId) } };
  }
  return { OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] };
}

/**
 * Search is scoped to patients who have a check-in or visit history at the
 * logged-in staff member's own clinic — not a global patient search. A
 * clinic shouldn't be able to browse patients it has no relationship with,
 * even though patient records are portable once a relationship exists.
 */
patientsRouter.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (query.length < 2) {
    res.json({ patients: [] });
    return;
  }

  const patients = await prisma.patient.findMany({
    where: {
      AND: [
        await visibleToStaffWhere(req as AuthenticatedRequest),
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

  // Same authorization scoping as search, whether reached via search or a
  // direct URL. A patient a doctor may not see gets exactly the same 404 as
  // one who doesn't exist.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, ...(await visibleToStaffWhere(req as unknown as AuthenticatedRequest)) },
  });

  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  const isDoctor = (req as unknown as AuthenticatedRequest).dashboardSession.role === 'DOCTOR';
  const { history, hasHiddenHistoryElsewhere, crossClinicBasis } = await getScopedHistory(patient.id, clinicId, {
    includeDiagnosis: isDoctor,
    viewer: { staffId, channel: 'DASHBOARD' },
  });

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
    ...identityView(patient),
    history,
    hasHiddenHistoryElsewhere,
    crossClinicBasis,
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
    where: { id: req.params.id, deletedAt: null, OR: [{ checkIns: { some: { clinicId } } }, { encounters: { some: { clinicId } } }] },
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

/**
 * "Print visit record": when a patient asks the front desk for a paper copy
 * of one of their visits at this clinic. Front desk never sees diagnoses on
 * screen (C2), but the printed record the patient asked for includes it, the
 * same PDF the patient can download from their own portal. Front-desk roles
 * only, this clinic's visits only, and every print is audit-logged.
 */
patientsRouter.get('/:id/visits/:encounterId/record', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Printing visit records is done at the front desk' });
    return;
  }

  const encounter = await prisma.encounter.findFirst({
    where: { id: req.params.encounterId, patientId: req.params.id, clinicId, patient: { deletedAt: null } },
    include: { patient: true, clinic: true, checkIn: { include: { department: true } }, consultedByStaff: true },
  });
  if (!encounter) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  const pdf = await renderVisitRecordPdf(buildVisitRecordDataFromEncounter(encounter));

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    clinicId,
    action: 'VISIT_RECORD_PRINTED_FOR_PATIENT',
    entityType: 'Encounter',
    entityId: encounter.id,
    metadata: { patientId: encounter.patientId },
  });

  const dateStamp = encounter.createdAt.toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="ACISI-visit-${dateStamp}.pdf"`,
    'Cache-Control': 'no-store',
  });
  res.send(pdf);
});

function sendSharingError(err: unknown, res: Response): boolean {
  if (err instanceof RecordSharingError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * "Request records": for a patient who has not authorised sharing, ask them
 * for a one-time code (on their web profile, and by SMS when it works).
 * Front-desk roles only.
 */
patientsRouter.post('/:id/record-requests', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Records are requested at the front desk' });
    return;
  }
  try {
    const { sms } = await requestRecords({ patientId: req.params.id as string, clinicId, staffId });
    res.status(201).json({ smsSent: sms === 'sent' });
  } catch (err) {
    if (!sendSharingError(err, res)) throw err;
  }
});

const shareCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits') });

/** Front desk entering the code the patient read out. */
patientsRouter.post('/:id/record-requests/verify', async (req, res) => {
  const { clinicId, staffId, role } = (req as unknown as AuthenticatedRequest).dashboardSession;
  if (role === 'DOCTOR') {
    res.status(403).json({ error: 'Records are requested at the front desk' });
    return;
  }
  const parsed = shareCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' });
    return;
  }
  try {
    const { accessUntil } = await enterRecordAccessCode({ patientId: req.params.id as string, clinicId, staffId, code: parsed.data.code });
    res.json({ accessUntil });
  } catch (err) {
    if (!sendSharingError(err, res)) throw err;
  }
});
