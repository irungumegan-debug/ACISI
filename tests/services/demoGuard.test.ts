jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findUnique: jest.fn(), findFirst: jest.fn() },
    clinic: { findUnique: jest.fn() },
    staff: { findFirst: jest.fn() },
  },
}));
const mockAtSend = jest.fn();
jest.mock('africastalking', () => () => ({ SMS: { send: mockAtSend } }));

import { prisma } from '../../src/db/prisma';
import { smsClient } from '../../src/config/africastalking';
import { assertDemoBoundary, DemoBoundaryError, isDemoRecipient } from '../../src/services/demoGuard';

const mockPatient = prisma.patient.findUnique as jest.Mock;
const mockPatientByPhone = prisma.patient.findFirst as jest.Mock;
const mockClinic = prisma.clinic.findUnique as jest.Mock;
const mockStaff = prisma.staff.findFirst as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('assertDemoBoundary', () => {
  const setup = (demoClinicId: string | null, isDemo: boolean) => {
    mockPatient.mockResolvedValue({ demoClinicId });
    mockClinic.mockResolvedValue({ isDemo });
  };

  it('lets a real patient use a real clinic, and a demo patient their own demo clinic', async () => {
    setup(null, false);
    await expect(assertDemoBoundary('p', 'real')).resolves.toBeUndefined();
    setup('demo-1', true);
    await expect(assertDemoBoundary('p', 'demo-1')).resolves.toBeUndefined();
  });

  it('keeps real patients out of demo clinics', async () => {
    setup(null, true);
    await expect(assertDemoBoundary('p', 'demo-1')).rejects.toThrow(DemoBoundaryError);
  });

  it('keeps demo patients out of real clinics and other demos', async () => {
    setup('demo-1', false);
    await expect(assertDemoBoundary('p', 'real')).rejects.toThrow('demo patient account');
    setup('demo-1', true);
    await expect(assertDemoBoundary('p', 'demo-2')).rejects.toThrow(DemoBoundaryError);
  });
});

describe('demo recipients and the SMS gate', () => {
  it('is decided by the database, never by the number itself', async () => {
    mockPatientByPhone.mockResolvedValue(null);
    mockStaff.mockResolvedValue(null);
    expect(await isDemoRecipient('+254700000001')).toBe(false);
    mockPatientByPhone.mockResolvedValue({ id: 'p' });
    expect(await isDemoRecipient('+254700000001')).toBe(true);
    expect(mockPatientByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumber: '+254700000001', demoClinicId: { not: null } } }),
    );
  });

  it('never sends an SMS to a demo recipient, and still sends to everyone else', async () => {
    mockStaff.mockResolvedValue(null);
    mockPatientByPhone.mockImplementation(async ({ where }) =>
      where.phoneNumber === '+254700000001' ? { id: 'demo' } : null,
    );

    await expect(smsClient.send({ to: ['+254700000001'], message: 'hi' })).resolves.toBeNull();
    expect(mockAtSend).not.toHaveBeenCalled();

    mockAtSend.mockResolvedValue({ ok: true });
    await smsClient.send({ to: ['+254700000001', '+254712345678'], message: 'hi' });
    expect(mockAtSend).toHaveBeenCalledWith({ to: ['+254712345678'], message: 'hi' });
  });
});
