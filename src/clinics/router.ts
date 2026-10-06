import { Router } from 'express';
import { z } from 'zod';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { pinPolicyError } from '../utils/pinPolicy';
import { findClinicByInviteCode, listActiveClinics, registerClinic } from '../services/clinicService';
import { DepartmentError, listActiveDepartments, prepareDepartmentList } from '../services/departmentService';

export const clinicsRouter = Router();

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
  adminPin: z.string().min(1),
  /** The clinic's own departments — at least one (see departmentService.prepareDepartmentList). */
  departments: z
    .array(
      z.object({
        name: z.string().max(100),
        code: z.string().max(10).nullish(),
        consultationFeeKes: z.number().int().min(0).nullish(),
      }),
    )
    .min(1, 'Add at least one department')
    .max(50),
  /** "I accept the Terms of Service and have read the Privacy Notice" — required. */
  acceptLegal: z.boolean().optional(),
});

/**
 * Brand-new clinic self-registration. The registrant becomes the clinic's
 * first ADMIN staff member, with their own staffCode + PIN — no separate
 * admin auth system, per the identity model in Part 1.
 */
clinicsRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const departmentsMissing = parsed.error.issues.some((i) => i.path[0] === 'departments');
    res.status(400).json({ error: departmentsMissing ? 'Add at least one department' : 'Please fill in all required fields with a valid PIN' });
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

  const pinError = pinPolicyError(parsed.data.adminPin, { phoneNumber: adminPhoneE164 });
  if (pinError) {
    res.status(400).json({ error: pinError });
    return;
  }

  let departments;
  try {
    departments = prepareDepartmentList(parsed.data.departments);
  } catch (err) {
    if (err instanceof DepartmentError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (parsed.data.acceptLegal !== true) {
    res.status(400).json({ error: 'Please accept the Terms of Service and Privacy Notice to register your clinic' });
    return;
  }

  const result = await registerClinic({
    departments,
    name: parsed.data.name,
    county: parsed.data.county,
    adminName: parsed.data.adminName,
    adminPhoneNumberE164: adminPhoneE164,
    adminPin: parsed.data.adminPin,
    acceptedTermsAndPrivacyNotice: true,
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
