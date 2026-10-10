import { Router } from 'express';
import { prisma } from '../db/prisma';
import { recordAuditEvent } from '../services/auditService';
import { revokeSessionsFor } from '../services/sessionRevocation';
import { AuthenticatedOwnerRequest } from './auth';

export const ownerClinicsRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Map of clinicId -> number, from a Prisma groupBy result. */
function byClinic<T extends { clinicId: string }>(rows: T[], value: (row: T) => number): Map<string, number> {
  return new Map(rows.map((r) => [r.clinicId, value(r)]));
}

/**
 * Every clinic with its business numbers — revenue, visits, staffing. The
 * owner site deliberately shows clinics, not patients: no patient names or
 * clinical details are returned anywhere on this router.
 */
ownerClinicsRouter.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const since30Days = new Date(Date.now() - 30 * DAY_MS);

  const [clinics, revenueAll, revenue30, visitsAll, visits30, staffByRole] = await Promise.all([
    prisma.clinic.findMany({
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
    }),
    prisma.checkIn.groupBy({ by: ['clinicId'], where: { status: 'PAID' }, _sum: { amountKes: true } }),
    prisma.checkIn.groupBy({
      by: ['clinicId'],
      where: { status: 'PAID', paidAt: { gte: since30Days } },
      _sum: { amountKes: true },
    }),
    prisma.encounter.groupBy({ by: ['clinicId'], _count: { _all: true } }),
    prisma.encounter.groupBy({ by: ['clinicId'], where: { createdAt: { gte: since30Days } }, _count: { _all: true } }),
    prisma.staff.groupBy({ by: ['clinicId', 'role'], where: { isActive: true }, _count: { _all: true } }),
  ]);

  const revenueTotal = byClinic(revenueAll, (r) => Number(r._sum.amountKes ?? 0));
  const revenueLast30 = byClinic(revenue30, (r) => Number(r._sum.amountKes ?? 0));
  const visitTotal = byClinic(visitsAll, (r) => r._count._all);
  const visitLast30 = byClinic(visits30, (r) => r._count._all);
  const doctors = byClinic(
    staffByRole.filter((r) => r.role === 'DOCTOR'),
    (r) => r._count._all,
  );
  const otherStaff = new Map<string, number>();
  for (const r of staffByRole.filter((s) => s.role !== 'DOCTOR')) {
    otherStaff.set(r.clinicId, (otherStaff.get(r.clinicId) ?? 0) + r._count._all);
  }

  res.json({
    clinics: clinics.map((c) => ({
      id: c.id,
      name: c.name,
      county: c.county,
      ussdCode: c.ussdCode,
      isActive: c.isActive,
      createdAt: c.createdAt,
      doctorCount: doctors.get(c.id) ?? 0,
      staffCount: otherStaff.get(c.id) ?? 0,
      visitCount: visitTotal.get(c.id) ?? 0,
      visitsLast30Days: visitLast30.get(c.id) ?? 0,
      revenueKes: revenueTotal.get(c.id) ?? 0,
      revenueLast30DaysKes: revenueLast30.get(c.id) ?? 0,
    })),
  });
});

/** One clinic: its numbers, departments, doctors and front-desk staff. No patient data. */
ownerClinicsRouter.get('/:id', async (req, res) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: req.params.id },
    include: {
      departments: { orderBy: { name: 'asc' } },
      staff: {
        orderBy: { createdAt: 'asc' },
        include: {
          department: { select: { name: true } },
          departments: { select: { department: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }

  const since30Days = new Date(Date.now() - 30 * DAY_MS);
  const [revenueAll, revenue30, visitsAll, visits30, upcomingAppointments, visitsByDoctor] = await Promise.all([
    prisma.checkIn.aggregate({ where: { clinicId: clinic.id, status: 'PAID' }, _sum: { amountKes: true } }),
    prisma.checkIn.aggregate({
      where: { clinicId: clinic.id, status: 'PAID', paidAt: { gte: since30Days } },
      _sum: { amountKes: true },
    }),
    prisma.encounter.count({ where: { clinicId: clinic.id } }),
    prisma.encounter.count({ where: { clinicId: clinic.id, createdAt: { gte: since30Days } } }),
    prisma.appointment.count({
      where: { clinicId: clinic.id, status: { in: ['REQUESTED', 'CONFIRMED'] }, scheduledFor: { gte: new Date() } },
    }),
    prisma.encounter.groupBy({
      by: ['consultedByStaffId'],
      where: { clinicId: clinic.id, consultedByStaffId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const consultations = new Map(visitsByDoctor.map((r) => [r.consultedByStaffId, r._count._all]));

  res.json({
    id: clinic.id,
    name: clinic.name,
    county: clinic.county,
    ussdCode: clinic.ussdCode,
    inviteCode: clinic.inviteCode,
    isActive: clinic.isActive,
    createdAt: clinic.createdAt,
    visitCount: visitsAll,
    visitsLast30Days: visits30,
    upcomingAppointments,
    revenueKes: Number(revenueAll._sum.amountKes ?? 0),
    revenueLast30DaysKes: Number(revenue30._sum.amountKes ?? 0),
    departments: clinic.departments.map((d) => ({ id: d.id, name: d.name, code: d.code, isActive: d.isActive })),
    staff: clinic.staff.map((s) => ({
      id: s.id,
      staffCode: s.staffCode,
      name: s.name,
      role: s.role,
      phoneNumber: s.phoneNumber,
      // Doctors can work in several departments; others keep their single (optional) one.
      departmentName: s.departments.length ? s.departments.map((d) => d.department.name).join(', ') : (s.department?.name ?? null),
      isActive: s.isActive,
      lastLoginAt: s.lastLoginAt,
      createdAt: s.createdAt,
      consultationCount: consultations.get(s.id) ?? 0,
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
