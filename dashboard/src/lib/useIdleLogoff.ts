import { useEffect, useRef } from 'react';

/** Matches IDLE_LOGOFF_SECONDS on the server (15 minutes). */
export const IDLE_LOGOFF_MS = 15 * 60 * 1000;
const PING_EVERY_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/** Set when the inactivity logoff happens, so the login page can say why. */
export const IDLE_FLAG = 'acisi-idle-logoff';

/**
 * Automatic logoff after 15 minutes without activity. Real activity (typing,
 * clicking, scrolling, touching) is reported to the server at most once a
 * minute (`ping`), which keeps the server-side session alive; background
 * refreshes are not activity. After 15 quiet minutes `onIdle` runs.
 */
export function useIdleLogoff(enabled: boolean, ping: () => Promise<unknown>, onIdle: () => void): void {
  const last = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const idleRef = useRef(onIdle);
  idleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    lastPing.current = Date.now();
    let fired = false;
    const onActivity = () => {
      const now = Date.now();
      last.current = now;
      if (now - lastPing.current >= PING_EVERY_MS) {
        lastPing.current = now;
        void ping().catch(() => undefined);
      }
    };
    const check = () => {
      if (!fired && Date.now() - last.current >= IDLE_LOGOFF_MS) {
        fired = true;
        try {
          sessionStorage.setItem(IDLE_FLAG, '1');
        } catch {
          // Private mode: the message just won't show.
        }
        idleRef.current();
      }
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [enabled, ping]);
}

/** True once, right after an inactivity logoff. */
export function takeIdleFlag(): boolean {
  try {
    const was = sessionStorage.getItem(IDLE_FLAG) === '1';
    sessionStorage.removeItem(IDLE_FLAG);
    return was;
  } catch {
    return false;
  }
}
