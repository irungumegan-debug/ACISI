import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireStaffSession, requireAdmin, AuthenticatedRequest } from './auth';
import {
  createDepartment,
  deleteDepartment,
  DepartmentError,
  listDepartmentsForAdmin,
  MAX_DEPARTMENT_FEE_KES,
  setDoctorDepartments,
  suggestDepartmentCode,
  updateDepartment,
} from '../services/departmentService';
import { regenerateInviteCode } from '../services/clinicService';
import { recordAuditEvent } from '../services/auditService';
import { getPaymentSettings } from '../services/billingService';
import { MAX_AMOUNT_KES } from '../services/billingMath';
import { clinicStkConfigured } from '../mpesa/clinicStk';
import { env } from '../config/env';
import {
  InvalidPinFormatError,
  StaffIsNotADoctorError,
  StaffNotFoundError,
  listClinicStaff,
  resetStaffPinByAdmin,
  setDoctorPresenceByAdmin,
} from '../services/staffService';

export const clinicSettingsRouter = Router();

clinicSettingsRouter.use(requireStaffSession, requireAdmin);

clinicSettingsRouter.get('/invite-code', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { inviteCode: true } });
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found' });
    return;
  }
  res.json({ inviteCode: clinic.inviteCode });
});

clinicSettingsRouter.post('/invite-code/regenerate', async (req, res) => {
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const inviteCode = await regenerateInviteCode(clinicId, staffId);
  res.json({ inviteCode });
});

clinicSettingsRouter.get('/staff', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const staff = await listClinicStaff(clinicId);
  res.json({ staff });
});

const resetPinSchema = z.object({ newPin: z.string().optional() });

/**
 * Resets one staff/doctor's PIN, scoped to the requesting admin's own
 * clinic. Returns the new PIN in plaintext exactly once, for the admin to
 * relay directly — never stored or logged in that form anywhere.
 */
clinicSettingsRouter.post('/staff/:id/reset-pin', async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await resetStaffPinByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      newPin: parsed.data.newPin,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidPinFormatError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const presenceSchema = z.object({ status: z.enum(['IN', 'OUT']) });

/** Lets a clinic admin mark one of their own doctors in/out for today, e.g. on a doctor's behalf for a planned absence. */
clinicSettingsRouter.post('/staff/:id/presence', async (req, res) => {
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be IN or OUT' });
    return;
  }

  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;

  try {
    const result = await setDoctorPresenceByAdmin({
      clinicId,
      staffId: req.params.id as string,
      requestedByStaffId: staffId,
      status: parsed.data.status,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaffNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof StaffIsNotADoctorError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// --- Payment settings (clinic admin only, like everything on this router) ---

const paymentSettingsSchema = z
  .object({
    acceptsCash: z.boolean(),
    acceptsCard: z.boolean(),
    acceptsMobileMoney: z.boolean(),
    mobileMoneyType: z.enum(['TILL', 'PAYBILL']).nullish(),
    mobileMoneyNumber: z
      .string()
      .trim()
      .regex(/^\d{5,7}$/, 'Till and paybill numbers are 5 to 7 digits')
      .nullish()
      .or(z.literal('')),
    paybillAccountFormat: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9-]*(\{(patientCode|billNumber)\}[A-Za-z0-9-]*)*$/, 'Use letters, numbers, - and {patientCode} or {billNumber}')
      .nullish()
      .or(z.literal('')),
    defaultConsultationFeeKes: z.number().int('Use a whole number of KES').min(0).max(MAX_AMOUNT_KES),
  })
  .refine((s) => s.acceptsCash || s.acceptsCard || s.acceptsMobileMoney, { message: 'Accept at least one payment method' })
  .refine((s) => !s.acceptsMobileMoney || (s.mobileMoneyType && s.mobileMoneyNumber), {
    message: 'Choose till or paybill and enter the number to accept mobile money',
  });

clinicSettingsRouter.get('/payment-settings', async (req, res) => {
  const { clinicId } = (req as AuthenticatedRequest).dashboardSession;
  const settings = await getPaymentSettings(clinicId);
  res.json({
    acceptsCash: settings.acceptsCash,
    acceptsCard: settings.acceptsCard,
    acceptsMobileMoney: settings.acceptsMobileMoney,
    mobileMoneyType: settings.mobileMoneyType,
    mobileMoneyNumber: settings.mobileMoneyNumber,
    paybillAccountFormat: settings.paybillAccountFormat,
    defaultConsultationFeeKes: settings.defaultConsultationFeeKes,
    stkConfigured: clinicStkConfigured(),
    stkMode: env.CLINIC_MPESA_ENV,
  });
});

clinicSettingsRouter.put('/payment-settings', async (req, res) => {
  const parsed = paymentSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
    return;
  }
  const { clinicId, staffId } = (req as AuthenticatedRequest).dashboardSession;
  const s = parsed.data;
  const data = {
    acceptsCash: s.acceptsCash,
    acceptsCard: s.acceptsCard,
    acceptsMobileMoney: s.acceptsMobileMoney,
    mobileMoneyType: s.mobileMoneyType || null,
    mobileMoneyNumber: s.mobileMoneyNumber || null,
    paybillAccountFormat: s.mobileMoneyType === 'PAYBILL' ? s.paybillAccountFormat || null : null,
    defaultConsultationFeeKes: s.defaultConsultationFeeKes,
    updatedByStaffId: staffId,
  };
  await prisma.clinicPaymentSettings.upsert({ where: { clinicId }, create: { clinicId, ...data }, update: data });
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'PAYMENT_SETTINGS_UPDATED',
    entityType: 'Clinic',
    entityId: clinicId,
    metadata: { ...data, updatedByStaffId: undefined },
  });
  res.json({ ok: true });
});

// --- Departments (admin) ------------------------------------------------------

function sendDepartmentError(res: import('express').Response, err: unknown): void {
  if (err instanceof DepartmentError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

const feeSchema = z
  .number({ invalid_type_error: 'The fee must be a number' })
  .int('The fee must be a whole number of KES')
  .min(0, "The fee can't be negative")
  .max(MAX_DEPARTMENT_FEE_KES, 'That fee is too large')
  .nullable();

clinicSettingsRouter.get('/departments', async (req, res) => {
  const { clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  res.json({ departments: await listDepartmentsForAdmin(clinicId) });
});

/** A suggested short code for a name, avoiding codes this clinic already uses. */
clinicSettingsRouter.get('/departments/suggest-code', async (req, res) => {
  const { clinicId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  const taken = (await listDepartmentsForAdmin(clinicId)).map((d) => d.code);
  try {
    res.json({ code: suggestDepartmentCode(name, taken) });
  } catch (err) {
    sendDepartmentError(res, err);
  }
});

const createDepartmentSchema = z.object({
  name: z.string().max(100),
  code: z.string().max(10).nullish(),
  consultationFeeKes: feeSchema.optional(),
});

clinicSettingsRouter.post('/departments', async (req, res) => {
  const parsed = createDepartmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid department' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.status(201).json(await createDepartment({ ...parsed.data, clinicId, staffId }));
  } catch (err) {
    sendDepartmentError(res, err);
  }
});

const updateDepartmentSchema = z
  .object({
    name: z.string().max(100).optional(),
    code: z.string().max(10).optional(),
    consultationFeeKes: feeSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

clinicSettingsRouter.patch('/departments/:id', async (req, res) => {
  const parsed = updateDepartmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid change' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    res.json(await updateDepartment({ departmentId: req.params.id as string, clinicId, staffId, patch: parsed.data }));
  } catch (err) {
    sendDepartmentError(res, err);
  }
});

/** Only for a department that has never been used; anything with history is deactivated instead. */
clinicSettingsRouter.delete('/departments/:id', async (req, res) => {
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    await deleteDepartment({ departmentId: req.params.id as string, clinicId, staffId });
    res.status(204).end();
  } catch (err) {
    sendDepartmentError(res, err);
  }
});

const doctorDepartmentsSchema = z.object({ departmentIds: z.array(z.string().min(1)).min(1, 'A doctor needs at least one department').max(50) });

/** Which departments a doctor works in. Applies immediately — doctors' departments are read on every request. */
clinicSettingsRouter.put('/staff/:id/departments', async (req, res) => {
  const parsed = doctorDepartmentsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid departments' });
    return;
  }
  const { clinicId, staffId } = (req as unknown as AuthenticatedRequest).dashboardSession;
  try {
    const departments = await setDoctorDepartments({ doctorId: req.params.id as string, clinicId, departmentIds: parsed.data.departmentIds, staffId });
    res.json({ departments });
  } catch (err) {
    sendDepartmentError(res, err);
  }
});
