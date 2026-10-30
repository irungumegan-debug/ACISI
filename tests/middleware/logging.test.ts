import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import { buildRequestLogger, pathWithoutQuery } from '../../src/middleware/requestLogger';
import { safeErrorForLog } from '../../src/utils/logger';

describe('pathWithoutQuery', () => {
  it('drops the query string, where search text and phone numbers travel', () => {
    expect(pathWithoutQuery('/api/staff/patients?q=0712345678')).toBe('/api/staff/patients');
    expect(pathWithoutQuery('/api/staff/walk-in/lookup?phone=%2B254712345678')).toBe('/api/staff/walk-in/lookup');
    expect(pathWithoutQuery(undefined)).toBe('');
  });
});

describe('safeErrorForLog', () => {
  it('keeps the error name, code and stack frames but never the message', () => {
    const err = Object.assign(new Error('Unique constraint failed on phoneNumber +254712345678 (Jane Wanjiru)'), { code: 'P2002' });
    const out = safeErrorForLog(err);
    expect(out.name).toBe('Error');
    expect(out.code).toBe('P2002');
    expect(JSON.stringify(out)).not.toContain('254712345678');
    expect(JSON.stringify(out)).not.toContain('Wanjiru');
  });
});

describe('request log line (C8)', () => {
  it('contains no login token, cookie, query string or IP address', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });

    const app = express();
    app.use(buildRequestLogger(pino(sink)));
    app.get('/api/staff/patients', (_req, res) => res.json({ patients: [] }));

    await request(app)
      .get('/api/staff/patients?q=0712345678')
      .set('Cookie', 'acisi_staff_session=secret-token-abc')
      .set('X-Forwarded-For', '41.90.1.2');

    const log = lines.join('');
    expect(log).toContain('/api/staff/patients');
    expect(log).not.toContain('0712345678');
    expect(log).not.toContain('secret-token-abc');
    expect(log).not.toContain('acisi_staff_session');
    expect(log).not.toContain('41.90.1.2');
    expect(log).not.toContain('127.0.0.1');
  });
});
