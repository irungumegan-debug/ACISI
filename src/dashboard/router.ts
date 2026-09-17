import { Router } from 'express';
import { authRouter } from './auth';
import { patientsRouter } from './patients';
import { checkinsRouter } from './checkins';
import { eventsRouter } from './events';
import { departmentsRouter } from './departments';

export const dashboardRouter = Router();

dashboardRouter.use('/auth', authRouter);
dashboardRouter.use('/patients', patientsRouter);
dashboardRouter.use('/checkins', checkinsRouter);
dashboardRouter.use('/events', eventsRouter);
dashboardRouter.use('/departments', departmentsRouter);
