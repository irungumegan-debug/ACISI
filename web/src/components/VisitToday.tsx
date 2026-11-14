import { useEffect, useState } from 'react';
import { Clock, FlaskConical, ReceiptText, Stethoscope, UsersRound } from 'lucide-react';
import { api, VisitToday } from '../lib/api';

/** How often the card asks for the latest place in the queue while the page is open. */
const REFRESH_MS = 20_000;

function placeText(position: number): string {
  if (position === 1) return 'You’re next';
  return `You’re number ${position}`;
}

function StageLine({ v }: { v: VisitToday }) {
  switch (v.stage) {
    case 'WAITING':
    case 'BACK_FROM_LAB':
      return (
        <>
          <p className="visit-place" aria-live="polite">
            <UsersRound size={22} aria-hidden /> {v.queuePosition ? placeText(v.queuePosition) : 'Waiting'}
          </p>
          <p>
            {v.stage === 'BACK_FROM_LAB'
              ? 'Your lab results are ready: you’re waiting to see the doctor again.'
              : v.queuePosition && v.queuePosition > 1
                ? `${v.queuePosition - 1} ${v.queuePosition === 2 ? 'person is' : 'people are'} ahead of you. This updates by itself.`
                : 'Please be ready: you’ll be called in next.'}
          </p>
        </>
      );
    case 'WITH_DOCTOR':
      return (
        <p className="visit-place">
          <Stethoscope size={22} aria-hidden /> With the doctor
        </p>
      );
    case 'AT_LAB':
      return (
        <p className="visit-place">
          <FlaskConical size={22} aria-hidden /> At the lab
        </p>
      );
    default:
      return (
        <>
          <p className="visit-place">
            <ReceiptText size={22} aria-hidden /> Ready to pay
          </p>
          <p>Please go to the front desk to finish your visit.</p>
        </>
      );
  }
}

/**
 * "My visit today": the patient's place in the queue, however they checked
 * in (front desk, portal or USSD). Refreshes every 20 seconds while the page
 * is open and visible, so it moves as each person ahead is called in.
 */
export function VisitTodayCard() {
  const [visits, setVisits] = useState<VisitToday[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    async function load(): Promise<void> {
      if (document.visibilityState === 'visible') {
        try {
          const r = await api.getVisitToday();
          if (stopped) return;
          setVisits(r.visits);
          setUpdatedAt(new Date());
        } catch {
          // Patchy data: keep the last numbers and try again next time.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void load(), REFRESH_MS);
    }
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (visits.length === 0) return null;

  return (
    <>
      {visits.map((v) => (
        <section key={v.encounterId} className="panel visit-today" aria-label="My visit today">
          <h2>
            <Clock size={18} aria-hidden /> My visit today
          </h2>
          <p>
            <strong>{v.clinicName}</strong> · {v.departmentName}
          </p>
          <StageLine v={v} />
          {updatedAt && (
            <p className="visit-updated">
              Updated {updatedAt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </section>
      ))}
    </>
  );
}
