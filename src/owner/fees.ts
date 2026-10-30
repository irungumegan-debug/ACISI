import { Router } from 'express';
import { listPendingFees } from '../services/feeService';

export const ownerFeesRouter = Router();

/** Unpaid ACISI check-in fees: ACISI ID, amount, age and restricted yes/no. No names, no health data. */
ownerFeesRouter.get('/', async (_req, res) => {
  res.json(await listPendingFees());
});
