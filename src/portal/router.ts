import { Router } from 'express';
import { portalAuthRouter } from './auth';
import { portalCheckinRouter, portalRecordsRouter } from './checkin';

export const portalRouter = Router();

portalRouter.use('/', portalAuthRouter);
portalRouter.use('/checkin', portalCheckinRouter);
portalRouter.use('/records', portalRecordsRouter);
