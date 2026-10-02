import { Router } from 'express';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { revokeSessionsFor } from '../services/sessionRevocation';
import { AuthenticatedOwnerRequest } from './auth';

export const ownerClinicsRouter = Router();

ownerClinicsRouter.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const clinics = await prisma.clinic.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { county: { contains: query, mode: 'insensitive' } },
            { ussdCode: { contains: query } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { staff: true, encounters: true } } },
  });

  res.json({
    clinics: clinics.map((c) => ({
      id: c.id,
      name: c.name,
      county: c.county,
      ussdCode: c.ussdCode,
      isActive: c.isActive,
      createdAt: c.createdAt,
      staffCount: c._count.staff,
      visitCount: c._count.encounters,
    })),
  });
});

ownerClinicsRouter.get('/:id', async (req, res) => {
  const { ownerId } = (req as unknown as AuthenticatedOwnerRequest).ownerSession;

  const clinic = await prisma.clinic.findUnique({
    where: { id: req.params.id },
    include: {
      departments: { orderBy: { name: 'asc' } },
      staff: { orderBy: { createdAt: 'asc' }, include: { department: { select: { name: true } } } },
      _count: { select: { encounters: true, appointments: true } },
    },
  });

  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }

  const [recentVisits, revenue] = await Promise.all([
    prisma.encounter.findMany({
      where: { clinicId: clinic.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientCode: true, deletedAt: true } },
        checkIn: { select: { department: { select: { name: true } } } },
      },
    }),
    prisma.checkIn.aggregate({ where: { clinicId: clinic.id, status: 'PAID' }, _sum: { amountKes: true } }),
  ]);

  // The visit list names patients, so viewing it is logged like any other
  // patient-data access.
  await recordAuditEvent({
    actorType: 'OWNER',
    actorId: ownerId,
    action: 'OWNER_CLINIC_VIEWED',
    entityType: 'Clinic',
    entityId: clinic.id,
  });

  res.json({
    id: clinic.id,
    name: clinic.name,
    county: clinic.county,
    ussdCode: clinic.ussdCode,
    inviteCode: clinic.inviteCode,
    isActive: clinic.isActive,
    createdAt: clinic.createdAt,
    visitCount: clinic._count.encounters,
    appointmentCount: clinic._count.appointments,
    revenueKes: Number(revenue._sum.amountKes ?? 0),
    departments: clinic.departments.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive })),
    staff: clinic.staff.map((s) => ({
      id: s.id,
      staffCode: s.staffCode,
      name: s.name,
      role: s.role,
      phoneNumber: s.phoneNumber,
      departmentName: s.department?.name ?? null,
      isActive: s.isActive,
      lastLoginAt: s.lastLoginAt,
      createdAt: s.createdAt,
    })),
    recentVisits: recentVisits.map((e) => ({
      encounterId: e.id,
      patientId: e.patient.id,
      patientName: `${e.patient.firstName} ${e.patient.lastName}`,
      patientCode: e.patient.patientCode,
      patientDeleted: e.patient.deletedAt !== null,
      departmentName: e.checkIn.department.name,
      status: e.status,
      visitedAt: e.createdAt,
    })),
  });
});

async function setClinicActive(req: AuthenticatedOwnerRequest, isActive: boolean) {
  const clinic = await prisma.clinic.findUnique({ where: { id: req.params.id } });
  if (!clinic) return null;

  const updated = await prisma.clinic.update({ where: { id: clinic.id }, data: { isActive } });
  if (!isActive) {
    // Logs out every staff member at this clinic right away; login is
    // already refused for an inactive clinic (findActiveStaffWithClinicByCode).
    await revokeSessionsFor(`clinic:${clinic.id}`);
  }

  await recordAuditEvent({
    actorType: 'OWNER',
    actorId: req.ownerSession.ownerId,
    action: isActive ? 'OWNER_CLINIC_REACTIVATED' : 'OWNER_CLINIC_DEACTIVATED',
    entityType: 'Clinic',
    entityId: clinic.id,
  });

  return updated;
}

ownerClinicsRouter.post('/:id/deactivate', async (req, res) => {
  const clinic = await setClinicActive(req as unknown as AuthenticatedOwnerRequest, false);
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  res.json({ id: clinic.id, isActive: clinic.isActive });
});

ownerClinicsRouter.post('/:id/reactivate', async (req, res) => {
  const clinic = await setClinicActive(req as unknown as AuthenticatedOwnerRequest, true);
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  res.json({ id: clinic.id, isActive: clinic.isActive });
});
