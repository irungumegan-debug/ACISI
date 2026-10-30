import fs from 'node:fs';
import path from 'node:path';

jest.mock('../../src/db/prisma', () => ({
  prisma: { auditLog: { create: jest.fn() }, staff: { findUnique: jest.fn() } },
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent, sanitizeAuditMetadata } from '../../src/services/auditService';

const mockCreate = prisma.auditLog.create as jest.Mock;
const mockStaff = prisma.staff.findUnique as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('audit details contain IDs and statuses only (C7)', () => {
  it('drops any key that could hold a name, phone number, diagnosis, prescription or free text', () => {
    const { clean, removed } = sanitizeAuditMetadata({
      patientId: 'p1',
      status: 'PAID',
      patientName: 'Jane Wanjiru',
      phoneNumber: '+254712345678',
      diagnosis: 'Malaria',
      prescription: 'Coartem',
      reason: 'Wrong patient',
      email: 'jane@example.com',
      idNumber: '12345678',
      nextOfKinPhone: '+254722000111',
      before: { name: 'Gynecology', code: 'GYN' },
    });
    expect(clean).toEqual({ patientId: 'p1', status: 'PAID', before: { code: 'GYN' } });
    expect(removed.sort()).toEqual(
      ['before.name', 'diagnosis', 'email', 'idNumber', 'nextOfKinPhone', 'patientName', 'phoneNumber', 'prescription', 'reason'].sort(),
    );
  });

  it('never writes a name or phone number to the database, whatever the caller passes', async () => {
    await recordAuditEvent({
      actorType: 'STAFF',
      actorId: 's1',
      staffId: 's1',
      clinicId: 'c1',
      action: 'X',
      entityType: 'Patient',
      metadata: { patientId: 'p1', phone: '0712345678', fullName: 'Jane Wanjiru' },
    });
    const written = JSON.stringify(mockCreate.mock.calls[0][0]);
    expect(written).not.toContain('0712345678');
    expect(written).not.toContain('Wanjiru');
    expect(written).toContain('p1');
  });

  it('no audit call in the code base passes a forbidden key (static check of every metadata literal)', () => {
    const forbidden = /^(.*name.*|.*phone.*|msisdn|.*email.*|diagnos.*|prescri.*|.*reason.*|.*note.*|idnumber|nextofkin.*|address|dob|dateofbirth|testname)$/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          for (const call of src.split('recordAuditEvent(').slice(1)) {
            const m = /metadata:\s*\{([^}]*)\}/.exec(call.slice(0, 600));
            if (!m) continue;
            for (const key of (m[1] as string).matchAll(/(\w+)\s*:/g)) {
              if (forbidden.test(key[1] as string)) offenders.push(`${path.relative(process.cwd(), full)}: ${key[1]}`);
            }
          }
        }
      }
    };
    walk(path.join(__dirname, '../../src'));
    expect(offenders).toEqual([]);
  });
});

describe('every audit row carries its clinic when there is one (C7)', () => {
  it('uses an explicit clinicId', async () => {
    await recordAuditEvent({ actorType: 'STAFF', staffId: 's1', clinicId: 'c-explicit', action: 'A', entityType: 'X' });
    expect(mockCreate.mock.calls[0][0].data.clinicId).toBe('c-explicit');
    expect(mockStaff).not.toHaveBeenCalled();
  });

  it('falls back to metadata.clinicId / viewedByClinicId', async () => {
    await recordAuditEvent({ actorType: 'STAFF', action: 'A', entityType: 'X', metadata: { viewedByClinicId: 'c-viewed' } });
    expect(mockCreate.mock.calls[0][0].data.clinicId).toBe('c-viewed');
  });

  it("falls back to the acting staff member's clinic", async () => {
    mockStaff.mockResolvedValue({ clinicId: 'c-staff' });
    await recordAuditEvent({ actorType: 'STAFF', actorId: 's1', staffId: 's1', action: 'PAYMENT_VOIDED', entityType: 'Payment' });
    expect(mockCreate.mock.calls[0][0].data.clinicId).toBe('c-staff');
  });

  it('stays null for a patient acting on their own account', async () => {
    await recordAuditEvent({ actorType: 'PATIENT', actorId: 'p1', action: 'PATIENT_SELF_DOWNLOADED_RECORD', entityType: 'Encounter' });
    expect(mockCreate.mock.calls[0][0].data.clinicId).toBeNull();
  });
});
