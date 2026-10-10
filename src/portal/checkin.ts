import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requirePatientSession, AuthenticatedPatientRequest } from './auth';
import {
  CheckInNotPendingError,
  initiateCheckIn,
  queryCheckInPayment,
  simulateCheckInPayment,
  SimulatedPaymentNotAllowedError,
} from '../services/checkInService';
import { DemoBoundaryError } from '../services/demoGuard';
import { getOwnVisitHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { buildVisitRecordDataFromEncounter, renderVisitRecordPdf } from '../services/visitRecordDocument';
import { patientNeedsWebCheckInPrivacyAck, recordLegalAcceptances } from '../services/legalService';
import { PRIVACY_NOTICE_VERSION } from '../config/legal';
import {
  patientIdentityInputSchema,
  PatientIdentityError,
  preparePatientIdentity,
} from '../services/patientIdentity';
import { kenyaDayRange, kenyaToday } from '../utils/kenyaTime';
import { errorSummary, logger } from '../utils/logger';

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

/** While the portal polls, start asking Safaricom about a still-pending check-in this long after the STK push. */
const PORTAL_QUERY_AFTER_MS = 20 * 1000;

/**
 * The patient's live check-in at this clinic today, if any: PAID with the
 * visit not yet finished, or still PENDING_PAYMENT. Checking in again while
 * one exists would only create a duplicate (and a second fee). A pending one
 * can't block the patient for long: the status query settles it, or after
 * an hour it becomes NEEDS_REVIEW, which doesn't block (front desk sorts it
 * out from the patient's M-Pesa SMS).
 */
async function findActiveCheckInToday(patientId: string, clinicId: string) {
  const { start } = kenyaDayRange(kenyaToday());
  return prisma.checkIn.findFirst({
    where: {
      patientId,
      clinicId,
      OR: [
        // A finished visit (DONE) doesn't block coming back later the same day.
        { status: 'PAID', createdAt: { gte: start }, encounter: { status: { not: 'DONE' } } },
        { status: 'PENDING_PAYMENT', createdAt: { gte: start } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * How many patients are ahead of this visit: WAITING encounters at the same
 * clinic and department that started earlier and could go to the same
 * doctor. Null once the patient is no longer waiting (or has no visit yet).
 */
async function queuePositionFor(
  encounter: {
    id: string;
    clinicId: string;
    status: string;
    assignedDoctorId: string | null;
    createdAt: Date;
  },
  departmentId: string,
) {
  if (encounter.status !== 'WAITING') return null;
  const ahead = await prisma.encounter.count({
    where: {
      clinicId: encounter.clinicId,
      status: 'WAITING',
      createdAt: { lt: encounter.createdAt },
      checkIn: { departmentId },
      ...(encounter.assignedDoctorId
        ? { OR: [{ assignedDoctorId: encounter.assignedDoctorId }, { assignedDoctorId: null }] }
        : {}),
    },
  });
  return ahead + 1;
}

/** What the portal shows for one of the patient's own check-ins; null if it isn't theirs. */
async function describeOwnCheckIn(checkInId: string, patientId: string) {
  const checkIn = await prisma.checkIn.findFirst({
    where: { id: checkInId, patientId },
    include: {
      clinic: { select: { name: true, isDemo: true } },
      department: { select: { name: true } },
      encounter: {
        select: { id: true, clinicId: true, status: true, assignedDoctorId: true, createdAt: true },
      },
    },
  });
  if (!checkIn) return null;
  return {
    checkInId: checkIn.id,
    status: checkIn.status,
    clinicName: checkIn.clinic.name,
    departmentName: checkIn.department.name,
    amountKes: Number(checkIn.amountKes),
    /** A demo clinic: no M-Pesa prompt; the patient taps the simulated payment instead. */
    simulatedPayment: checkIn.clinic.isDemo,
    queuePosition: checkIn.encounter ? await queuePositionFor(checkIn.encounter, checkIn.departmentId) : null,
  };
}

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
    prisma.department.findFirst({
      where: { id: parsed.data.departmentId, clinicId: parsed.data.clinicId, isActive: true },
    }),
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

  // Tapping "Confirm check-in" again (or after a page reload) must never
  // create a second check-in and STK push: hand back the one in progress.
  const active = await findActiveCheckInToday(patient.id, clinic.id);
  if (active) {
    res.status(200).json({ ...(await describeOwnCheckIn(active.id, patient.id)), existing: true });
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

  let checkIn;
  try {
    ({ checkIn } = await initiateCheckIn({
      ussdSessionId: `WEB-${crypto.randomUUID()}`,
      patientId: patient.id,
      clinicId: clinic.id,
      clinicName: clinic.name,
      departmentId: department.id,
      phoneNumberE164: patient.phoneNumber,
    }));
  } catch (err) {
    if (err instanceof DemoBoundaryError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }

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

  res.status(201).json({ ...(await describeOwnCheckIn(checkIn.id, patient.id)), existing: false });
});

/**
 * Polled by the portal every few seconds after the STK push, until the
 * M-Pesa callback (or the status worker) moves the check-in to PAID or
 * FAILED. Scoped to the logged-in patient's own check-ins: anything else is
 * a 404.
 */
portalCheckinRouter.get('/:checkInId', async (req, res) => {
  const { patientId } = (req as unknown as AuthenticatedPatientRequest).patientSession;
  const checkInId = req.params.checkInId as string;
  const own = await prisma.checkIn.findFirst({
    where: { id: checkInId, patientId },
    select: { status: true, createdAt: true },
  });
  if (!own) {
    res.status(404).json({ error: 'Check-in not found' });
    return;
  }

  // Don't rely on the callback alone: from ~20s after the STK push, ask
  // Safaricom directly while the patient waits (throttled per check-in, and
  // a no-op if the callback has already settled it).
  if (own.status === 'PENDING_PAYMENT' && Date.now() - own.createdAt.getTime() >= PORTAL_QUERY_AFTER_MS) {
    try {
      await queryCheckInPayment(checkInId);
    } catch (err) {
      // The patient's page just keeps polling; the sweep tries again too.
      logger.warn({ err: errorSummary(err), checkInId }, 'Check-in payment query from portal failed');
    }
  }

  res.json(await describeOwnCheckIn(checkInId, patientId));
});

/**
 * Demo clinics only: the patient's simulated payment of the check-in fee
 * (see checkInService.simulateCheckInPayment). Nothing is charged. Refused
 * at a real clinic, and for anyone else's check-in (404).
 */
portalCheckinRouter.post('/:checkInId/simulate-payment', async (req, res) => {
  const { patientId } = (req as unknown as AuthenticatedPatientRequest).patientSession;
  const checkInId = req.params.checkInId as string;
  try {
    await simulateCheckInPayment(checkInId, patientId);
  } catch (err) {
    if (err instanceof SimulatedPaymentNotAllowedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    // Already paid (a double tap): just report where it stands.
    if (!(err instanceof CheckInNotPendingError)) {
      if (err instanceof Error && err.message === 'Check-in not found') {
        res.status(404).json({ error: 'Check-in not found' });
        return;
      }
      throw err;
    }
  }
  res.json(await describeOwnCheckIn(checkInId, patientId));
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
    include: {
      patient: true,
      clinic: true,
      checkIn: { include: { department: true } },
      consultedByStaff: true,
    },
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
