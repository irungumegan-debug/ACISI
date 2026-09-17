import { Router } from 'express';
import { requireStaffSession } from './auth';
import { listActiveDepartments } from '../services/departmentService';

export const departmentsRouter = Router();

departmentsRouter.use(requireStaffSession);

/** Backs the queue's department filter — same canonical list the USSD/web check-in flows use. */
departmentsRouter.get('/', async (_req, res) => {
  const departments = await listActiveDepartments();
  res.json({ departments });
});
