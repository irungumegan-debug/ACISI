import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import { initiateCheckIn } from '../services/checkInService';
import { getOwnVisitHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { buildVisitRecordDataFromEncounter, renderVisitRecordPdf } from '../services/visitRecordDocument';
import { patientNeedsWebCheckInPrivacyAck, recordLegalAcceptances } from '../services/legalService';
import { PRIVACY_NOTICE_VERSION } from '../config/legal';
import { patientIdentityInputSchema, PatientIdentityError, preparePatientIdentity } from '../services/patientIdentity';

export const portalCheckinRouter = Router();
export const portalRecordsRouter = Router();

portalCheckinRouter.use(requirePatientSession);
portalRecordsRouter.use(requirePatientSession);

const checkinSchema = z.object({
  clinicId: z.string().min(1),
  departmentId: z.string().min(1),
  /** The Privacy Notice checkbox — required only when GET /privacy-notice says so. */
  privacyNoticeAcknowledged: z.boolean().optional(),
  /** Optional ID document and next of kin; empty fields leave what's on file alone. */
  identity: patientIdentityInputSchema.optional(),
});

/**
 * Whether checking in at this clinic needs the Privacy Notice checkbox:
 * once per patient per clinic, and again whenever the notice's version
 * changes. Returns the clinic's name for the checkbox wording.
 */
portalCheckinRouter.get('/privacy-notice', async (req, res) => {
  const clinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : '';
  const clinic = clinicId ? await prisma.clinic.findUnique({ where: { id: clinicId } }) : null;
  if (!clinic || !clinic.isActive) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;
  res.json({
    acknowledgmentRequired: await patientNeedsWebCheckInPrivacyAck(patientId, clinic.id),
    clinicName: clinic.name,
    version: PRIVACY_NOTICE_VERSION,
  });
});

/**
 * Web equivalent of the USSD check-in flow — calls the exact same
 * checkInService.initiateCheckIn used there, so payment/idempotency/SMS
 * behavior is identical regardless of channel.
 */
portalCheckinRouter.post('/', async (req, res) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'clinicId is required' });
    return;
  }

  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;

  const [patient, clinic, department] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId } }),
    prisma.clinic.findUnique({ where: { id: parsed.data.clinicId } }),
    prisma.department.findFirst({ where: { id: parsed.data.departmentId, clinicId: parsed.data.clinicId, isActive: true } }),
  ]);

  if (!patient) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!clinic || !clinic.isActive) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  if (!department) {
    res.status(400).json({ error: 'Please choose a valid department' });
    return;
  }

  const acknowledgmentRequired = await patientNeedsWebCheckInPrivacyAck(patient.id, clinic.id);
  if (acknowledgmentRequired && parsed.data.privacyNoticeAcknowledged !== true) {
    res.status(400).json({
      error: `Please confirm you have read the ACISI Privacy Notice before checking in at ${clinic.name}`,
      code: 'PRIVACY_NOTICE_ACK_REQUIRED',
    });
    return;
  }

  let identityUpdate: ReturnType<typeof preparePatientIdentity> = {};
  try {
    identityUpdate = parsed.data.identity ? preparePatientIdentity(parsed.data.identity, 'fillIn') : {};
  } catch (err) {
    if (err instanceof PatientIdentityError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (Object.keys(identityUpdate).length > 0) {
    await prisma.patient.update({ where: { id: patient.id }, data: identityUpdate });
    await recordAuditEvent({
      actorType: 'PATIENT',
      actorId: patient.id,
      action: 'PATIENT_DETAILS_UPDATED',
      entityType: 'Patient',
      entityId: patient.id,
      metadata: { fields: Object.keys(identityUpdate), channel: 'PORTAL_CHECKIN' },
    });
  }

  const { checkIn } = await initiateCheckIn({
    ussdSessionId: `WEB-${crypto.randomUUID()}`,
    patientId: patient.id,
    clinicId: clinic.id,
    clinicName: clinic.name,
    departmentId: department.id,
    phoneNumberE164: patient.phoneNumber,
  });

  if (acknowledgmentRequired) {
    await recordLegalAcceptances(['PRIVACY_NOTICE'], 'PATIENT_WEB_CHECKIN', {
      patientId: patient.id,
      clinicId: clinic.id,
      checkInId: checkIn.id,
    });
  }

  if (checkIn.status === 'FAILED') {
    res.status(502).json({ error: 'Could not start the payment request. Please try again shortly.' });
    return;
  }

  res.status(201).json({ checkInId: checkIn.id, status: checkIn.status });
});

portalRecordsRouter.get('/', async (req, res) => {
  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;

  const history = await getOwnVisitHistory(patientId);

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    action: 'PATIENT_SELF_VIEWED_HISTORY',
    entityType: 'Patient',
    entityId: patientId,
  });

  res.json({ history });
});

/**
 * Downloads a single past visit as a PDF — patient name/ID, clinic,
 * department, visit date, diagnosis, and prescription, for the patient to
 * show a pharmacist or keep for their own records. Scoped to the logged-in
 * patient's own encounters only: a 404 (never a 403, so a mismatched ID
 * can't be distinguished from one that doesn't exist) covers both a bad ID
 * and an attempt to reach another patient's visit.
 */
portalRecordsRouter.get('/:encounterId/download', async (req, res) => {
  const { patientId } = (req as unknown as AuthenticatedPatientRequest).patientSession;

  const encounter = await prisma.encounter.findFirst({
    where: { id: req.params.encounterId, patientId },
    include: { patient: true, clinic: true, checkIn: { include: { department: true } }, consultedByStaff: true },
  });

  if (!encounter) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  const pdf = await renderVisitRecordPdf(buildVisitRecordDataFromEncounter(encounter));

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patientId,
    action: 'PATIENT_SELF_DOWNLOADED_RECORD',
    entityType: 'Encounter',
    entityId: encounter.id,
  });

  const dateStamp = encounter.createdAt.toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="ACISI-visit-${dateStamp}.pdf"`,
  });
  res.send(pdf);
});
