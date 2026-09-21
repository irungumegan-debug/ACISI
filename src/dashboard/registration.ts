import { Router } from 'express';
import { z } from 'zod';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { InvalidInviteCodeError, registerStaffViaInviteCode } from '../services/staffService';

export const staffRegistrationRouter = Router();

const PIN_PATTERN = /^\d{4,6}$/;

const registerSchema = z.object({
  name: z.string().min(1),
  phoneNumber: z.string().min(1),
  inviteCode: z.string().min(1),
  pin: z.string().regex(PIN_PATTERN, 'PIN must be 4-6 digits'),
  role: z.enum(['RECEPTIONIST', 'CLINICIAN', 'DOCTOR']),
});

/**
 * Doctor and front-desk staff signup — both require a valid clinic invite
 * code (see clinicService.registerClinic for how one is minted). Never
 * creates an ADMIN; that role only comes from clinic self-registration.
 */
staffRegistrationRouter.post('/', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please fill in all required fields with a valid PIN' });
    return;
  }

  let phoneE164: string;
  try {
    phoneE164 = toE164(parsed.data.phoneNumber);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }
    throw err;
  }

  try {
    const staff = await registerStaffViaInviteCode({
      name: parsed.data.name,
      phoneNumberE164: phoneE164,
      pin: parsed.data.pin,
      inviteCode: parsed.data.inviteCode,
      role: parsed.data.role,
    });

    res.status(201).json({ staffCode: staff.staffCode });
  } catch (err) {
    if (err instanceof InvalidInviteCodeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if ((err as { code?: string })?.code === 'P2002') {
      res.status(409).json({ error: 'A staff account with that phone number already exists' });
      return;
    }
    throw err;
  }
});
