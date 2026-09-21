import { Router } from 'express';
import { authRouter } from './auth';
import { patientsRouter } from './patients';
import { checkinsRouter } from './checkins';
import { eventsRouter } from './events';
import { staffRegistrationRouter } from './registration';
import { clinicSettingsRouter } from './clinicSettings';
import { doctorRouter } from './doctor';

export const dashboardRouter = Router();

dashboardRouter.use('/auth', authRouter);
dashboardRouter.use('/register', staffRegistrationRouter);
dashboardRouter.use('/clinic', clinicSettingsRouter);
dashboardRouter.use('/patients', patientsRouter);
dashboardRouter.use('/checkins', checkinsRouter);
dashboardRouter.use('/doctor', doctorRouter);
dashboardRouter.use('/events', eventsRouter);
