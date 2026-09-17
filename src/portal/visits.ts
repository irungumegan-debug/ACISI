import { Router } from 'express';
import { prisma } from '../db/prisma';
import { findPatientByPhone } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';
import { AuthenticatedPatientRequest, requirePatientSession } from './auth';

export const portalVisitsRouter = Router();

portalVisitsRouter.use(requirePatientSession);

/**
 * A patient's own visit history — read-only, strictly filtered to the phone
 * number on their OTP-verified session (never a body/query param), so one
 * patient can never see another's records. No Patient row yet (never
 * checked in) is a valid, empty state, not an error.
 */
portalVisitsRouter.get('/', async (req, res) => {
  const { phoneNumberE164 } = (req as AuthenticatedPatientRequest).patientSession;

  const patient = await findPatientByPhone(phoneNumberE164);
  if (!patient) {
    res.json({ visits: [] });
    return;
  }

  const encounters = await prisma.encounter.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: 'desc' },
    include: {
      clinic: { select: { name: true } },
      checkIn: { select: { department: { select: { name: true } } } },
    },
  });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: patient.id,
    action: 'PATIENT_SELF_VIEWED_HISTORY',
    entityType: 'Patient',
    entityId: patient.id,
    metadata: { channel: 'WEB_PORTAL' },
  });

  res.json({
    visits: encounters.map((e) => ({
      encounterId: e.id,
      clinicName: e.clinic.name,
      departmentName: e.checkIn.department?.name ?? 'General',
      visitedAt: e.createdAt,
      status: e.consultationStatus,
      notes: e.notes,
      prescription: e.prescription,
    })),
  });
});
