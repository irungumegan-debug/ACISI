import { Router } from 'express';
import { z } from 'zod';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { findClinicByInviteCode, listActiveClinics, registerClinic } from '../services/clinicService';
import { listActiveDepartments } from '../services/departmentService';

export const clinicsRouter = Router();

const PIN_PATTERN = /^\d{4,6}$/;

/** Used by the web check-in form (patient portal) to populate a clinic picker — same list the USSD menu offers. */
clinicsRouter.get('/', async (_req, res) => {
  const clinics = await listActiveClinics();
  res.json({ clinics });
});

/** Used by the web check-in form (patient portal) to populate a department picker once a clinic is chosen. */
clinicsRouter.get('/:id/departments', async (req, res) => {
  const departments = await listActiveDepartments(req.params.id as string);
  res.json({ departments });
});

/**
 * Public lookup used by the doctor/staff signup form: given the invite code
 * the prospective doctor was handed, list the clinic's departments so they
 * can pick which one they're joining. Doesn't leak anything beyond
 * department names, and requires the same valid invite code signup itself does.
 */
clinicsRouter.get('/invite-code/:code/departments', async (req, res) => {
  const clinic = await findClinicByInviteCode(req.params.code);
  if (!clinic || !clinic.isActive) {
    res.status(404).json({ error: 'Invite code not recognized' });
    return;
  }

  const departments = await listActiveDepartments(clinic.id);
  res.json({ clinicName: clinic.name, departments });
});

const registerSchema = z.object({
  name: z.string().min(1),
  county: z.string().optional(),
  adminName: z.string().min(1),
  adminPhoneNumber: z.string().min(1),
  adminPin: z.string().regex(PIN_PATTERN, 'PIN must be 4-6 digits'),
});

/**
 * Brand-new clinic self-registration. The registrant becomes the clinic's
 * first ADMIN staff member, with their own staffCode + PIN — no separate
 * admin auth system, per the identity model in Part 1.
 */
clinicsRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please fill in all required fields with a valid PIN' });
    return;
  }

  let adminPhoneE164: string;
  try {
    adminPhoneE164 = toE164(parsed.data.adminPhoneNumber);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }
    throw err;
  }

  const result = await registerClinic({
    name: parsed.data.name,
    county: parsed.data.county,
    adminName: parsed.data.adminName,
    adminPhoneNumberE164: adminPhoneE164,
    adminPin: parsed.data.adminPin,
  }).catch((err) => {
    if (err?.code === 'P2002') return null;
    throw err;
  });

  if (!result) {
    res.status(409).json({ error: 'A clinic or admin account with those details already exists' });
    return;
  }

  res.status(201).json({
    clinicName: result.clinic.name,
    inviteCode: result.clinic.inviteCode,
    staffCode: result.adminStaffCode,
  });
});
