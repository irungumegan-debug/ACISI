import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireStaffSession, AuthenticatedRequest } from './auth';
import { getScopedHistory } from '../services/patientService';
import { recordAuditEvent } from '../services/auditService';

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
    history,
    hasHiddenHistoryElsewhere,
  });
});
