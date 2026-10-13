import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({ prisma: { patient: { findMany: jest.fn(), updateMany: jest.fn() } } }));

import { prisma } from '../../src/db/prisma';
import { isStopRequest, smsInboundRouter } from '../../src/sms/inbound';

function app() {
  const a = express();
  a.use(express.urlencoded({ extended: true }));
  a.use('/sms', smsInboundRouter);
  return a;
}

beforeEach(() => jest.clearAllMocks());

it.each(['STOP', 'stop', ' Stop. ', 'STOP ALL', 'Unsubscribe', 'acha'])('treats %j as STOP', (t) => expect(isStopRequest(t)).toBe(true));
it.each(['Hello', 'stopping by later', '', undefined])('ignores %j', (t) => expect(isStopRequest(t)).toBe(false));

it('a STOP reply opts out every patient on that phone', async () => {
  (prisma.patient.findMany as jest.Mock).mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }]);
  const res = await request(app()).post('/sms/inbound').type('form').send({ from: '+254712345678', to: '12345', text: 'STOP' });
  expect(res.status).toBe(200);
  expect(prisma.patient.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { phoneNumber: '+254712345678', deletedAt: null } }));
  expect(prisma.patient.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p-1', 'p-2'] } }, data: { smsOptOut: true, smsOptOutUpdatedAt: expect.any(Date) } });
});

it('any other reply changes nothing', async () => {
  const res = await request(app()).post('/sms/inbound').type('form').send({ from: '+254712345678', text: 'Thanks' });
  expect(res.status).toBe(200);
  expect(prisma.patient.updateMany).not.toHaveBeenCalled();
});
