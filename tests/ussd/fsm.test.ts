import { splitUssdText } from '../../src/ussd/fsm';
import { mainMenu } from '../../src/ussd/states/mainMenu';
import { staffMenu } from '../../src/ussd/states/staffLogin';
import { ENTER_SENTINEL, UssdSessionContext } from '../../src/ussd/types';

function freshSession(): UssdSessionContext {
  return {
    sessionId: 'session-1',
    state: 'MAIN_MENU',
    phoneNumberE164: '+254712345678',
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('splitUssdText', () => {
  it('returns no tokens for an empty first request', () => {
    expect(splitUssdText('')).toEqual([]);
  });

  it('splits accumulated keystrokes on *', () => {
    expect(splitUssdText('1*482*1')).toEqual(['1', '482', '1']);
  });
});

describe('mainMenu', () => {
  it('renders the menu on first entry without consuming input', async () => {
    const result = await mainMenu(freshSession(), ENTER_SENTINEL);
    expect(result.continueSession).toBe(true);
    expect(result.response).toContain('Welcome to ACISI');
    expect(result.nextState).toBeUndefined();
  });

  it('routes "1" to the check-in flow', async () => {
    const result = await mainMenu(freshSession(), '1');
    expect(result.nextState).toBe('CHECKIN_ENTER_CLINIC_CODE');
    expect(result.continueSession).toBe(true);
  });

  it('routes "2" to the staff login flow', async () => {
    const result = await mainMenu(freshSession(), '2');
    expect(result.nextState).toBe('STAFF_ENTER_PIN');
  });

  it('re-prompts on an invalid choice without changing state', async () => {
    const result = await mainMenu(freshSession(), '9');
    expect(result.nextState).toBeUndefined();
    expect(result.response).toContain('Invalid choice');
  });
});

describe('staffMenu', () => {
  it('routes "1" to patient history lookup', async () => {
    const result = await staffMenu(freshSession(), '1');
    expect(result.nextState).toBe('STAFF_HISTORY_ENTER_PHONE');
  });

  it('re-prompts on an invalid choice', async () => {
    const result = await staffMenu(freshSession(), '9');
    expect(result.nextState).toBeUndefined();
    expect(result.continueSession).toBe(true);
  });
});
