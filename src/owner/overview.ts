import { Router } from 'express';
import { prisma } from '../db/prisma';

export const ownerOverviewRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Platform-wide headline numbers for the owner site's home page. Counts only — no patient data. */
ownerOverviewRouter.get('/', async (_req, res) => {
  const since30Days = new Date(Date.now() - 30 * DAY_MS);

  const [
    activeClinics,
    totalClinics,
    activeStaff,
    totalStaff,
    activeDoctors,
    activePatients,
    deletedPatients,
    totalVisits,
    visitsLast30Days,
    upcomingAppointments,
    revenueAll,
    revenueLast30Days,
  ] = await Promise.all([
    prisma.clinic.count({ where: { isActive: true } }),
    prisma.clinic.count(),
    prisma.staff.count({ where: { isActive: true } }),
    prisma.staff.count(),
    prisma.staff.count({ where: { isActive: true, role: 'DOCTOR' } }),
    prisma.patient.count({ where: { deletedAt: null } }),
    prisma.patient.count({ where: { deletedAt: { not: null } } }),
    prisma.encounter.count(),
    prisma.encounter.count({ where: { createdAt: { gte: since30Days } } }),
    prisma.appointment.count({ where: { status: { in: ['REQUESTED', 'CONFIRMED'] }, scheduledFor: { gte: new Date() } } }),
    prisma.checkIn.aggregate({ where: { status: 'PAID' }, _sum: { amountKes: true } }),
    prisma.checkIn.aggregate({ where: { status: 'PAID', paidAt: { gte: since30Days } }, _sum: { amountKes: true } }),
  ]);

  res.json({
    clinics: { active: activeClinics, total: totalClinics },
    staff: { active: activeStaff, total: totalStaff },
    doctors: { active: activeDoctors },
    patients: { active: activePatients, deleted: deletedPatients },
    visits: { total: totalVisits, last30Days: visitsLast30Days },
    upcomingAppointments,
    revenueKes: {
      total: Number(revenueAll._sum.amountKes ?? 0),
      last30Days: Number(revenueLast30Days._sum.amountKes ?? 0),
    },
  });
});
