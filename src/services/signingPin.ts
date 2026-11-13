import { recordAuditEvent } from './auditService';
import { clearLockout, isLockedOut, lockoutMessage, recordWrongPin } from './pinLockout';
import { comparePin, findActiveStaffById } from './staffService';

export class PinLockedOutError extends Error {
  constructor() {
    super(lockoutMessage());
    this.name = 'PinLockedOutError';
  }
}

export class InvalidPinError extends Error {
  constructor() {
    super('Incorrect PIN. Please try again.');
    this.name = 'InvalidPinError';
  }
}

/**
 * A staff member re-entering their own PIN as the act of signing something
 * (a consultation, a lab request, lab results). Same per-account wrong-PIN
 * counter as login: a locked account can't sign, and wrong signing PINs
 * count towards the lock. Writes one audit row either way (okAction or
 * failedAction). Throws PinLockedOutError / InvalidPinError; returns
 * normally when the PIN is right.
 */
export async function verifySigningPin(input: {
  staffId: string;
  pin: string;
  clinicId?: string;
  okAction: string;
  failedAction: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const subject = `staff:${input.staffId}` as const;
  if (await isLockedOut(subject)) throw new PinLockedOutError();

  const staff = await findActiveStaffById(input.staffId);
  const pinValid = staff ? await comparePin(staff, input.pin) : false;

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    clinicId: input.clinicId,
    action: pinValid ? input.okAction : input.failedAction,
    entityType: input.entityType,
    entityId: input.entityId,
  });

  if (!pinValid) {
    if (await recordWrongPin(subject)) throw new PinLockedOutError();
    throw new InvalidPinError();
  }
  await clearLockout(subject);
}
