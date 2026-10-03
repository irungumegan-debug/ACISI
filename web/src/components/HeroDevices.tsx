import { useEffect, useRef } from 'react';
import { Building2, CalendarCheck, ChevronDown, CircleCheck, FileText, ReceiptText, Smartphone, Users } from 'lucide-react';
import { LogoMark } from './Logo';

/**
 * The hero's device showcase: a laptop showing the clinic staff console and a
 * phone showing patient check-in, built in HTML/CSS 3D (no images). Every
 * name and number on the screens is labelled sample data. Purely
 * decorative, so the whole thing is hidden from screen readers.
 */
const QUEUE = [
  { initials: 'AD', name: 'Achieng Demo', time: '08:42', dept: 'General', status: 'In consultation', tone: 'info' },
  { initials: 'KS', name: 'Kamau Sample', time: '08:55', dept: 'Pediatrics', status: 'Waiting', tone: 'warning', walkIn: true },
  { initials: 'WE', name: 'Wanjiku Example', time: '09:10', dept: 'General', status: 'Waiting', tone: 'warning' },
  { initials: 'OT', name: 'Otieno Test', time: '08:20', dept: 'Dental', status: 'Paid', tone: 'success' },
] as const;

function LaptopScreen() {
  return (
    <div className="mock-console">
      <aside className="mock-sidebar">
        <LogoMark size={18} title="" />
        <span className="mock-nav is-active">
          <Users size={9} /> Queue
        </span>
        <span className="mock-nav">
          <FileText size={9} /> Patients
        </span>
        <span className="mock-nav">
          <CalendarCheck size={9} /> Appts
        </span>
        <span className="mock-nav">
          <ReceiptText size={9} /> Summary
        </span>
      </aside>
      <div className="mock-main">
        <div className="mock-top">
          <div>
            <p className="mock-title">Today&apos;s queue</p>
            <p className="mock-sub">Sample Clinic · sample data</p>
          </div>
          <span className="mock-btn">+ Walk-in</span>
        </div>
        <div className="mock-stats">
          <span className="mock-stat tone-warning">
            <b>2</b> Waiting
          </span>
          <span className="mock-stat tone-info">
            <b>1</b> With doctor
          </span>
          <span className="mock-stat tone-success">
            <b>1</b> Paid
          </span>
        </div>
        <div className="mock-body">
          <ul className="mock-queue">
            {QUEUE.map((row) => (
              <li key={row.name}>
                <span className="mock-avatar">{row.initials}</span>
                <span className="mock-who">
                  <b>{row.name}</b>
                  <small>
                    {row.time} · {row.dept}
                  </small>
                </span>
                {'walkIn' in row && <span className="mock-badge tone-gold">Walk-in</span>}
                <span className={`mock-badge tone-${row.tone}`}>{row.status}</span>
              </li>
            ))}
          </ul>
          <div className="mock-checkout">
            <p className="mock-card-label">Checkout · Otieno Test</p>
            <p className="mock-total">KES 1,500</p>
            <p className="mock-line">
              <span>M-Pesa</span>
              <span>KES 1,500</span>
            </p>
            <span className="mock-badge tone-success mock-paid">
              <CircleCheck size={8} /> Paid
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneScreen() {
  return (
    <div className="mock-phone">
      <div className="mock-phone-head">
        <LogoMark size={16} title="" />
        <span>ACISI</span>
      </div>
      <p className="mock-phone-title">Check in to your clinic</p>
      <p className="mock-phone-label">Clinic</p>
      <span className="mock-select">
        <Building2 size={9} /> Sample Clinic <ChevronDown size={9} />
      </span>
      <p className="mock-phone-label">Department</p>
      <span className="mock-select">
        General <ChevronDown size={9} />
      </span>
      <span className="mock-phone-btn">Check in</span>
      <div className="mock-summary">
        <p className="mock-card-label">Visit summary</p>
        <p className="mock-summary-line">Sample Clinic · General</p>
        <p className="mock-summary-line muted">Sent to your phone by SMS</p>
      </div>
    </div>
  );
}

export function HeroDevices() {
  const stage = useRef<HTMLDivElement>(null);

  // Subtle parallax on desktop pointers only; off with reduced motion.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fine = window.matchMedia('(pointer: fine) and (min-width: 1024px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduced.matches) return;
    const hero = el.closest('.hero') ?? el;
    let frame = 0;
    const onMove = (e: Event) => {
      const { clientX, clientY } = e as MouseEvent;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = clientX / window.innerWidth - 0.5;
        const y = clientY / window.innerHeight - 0.5;
        el.style.setProperty('--px', x.toFixed(3));
        el.style.setProperty('--py', y.toFixed(3));
      });
    };
    hero.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      hero.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <div className="devices" ref={stage}>
      <div className="devices-glow" aria-hidden />
      <div className="devices-stage" aria-hidden>
        <div className="laptop-float">
          <div className="laptop">
            <div className="laptop-lid">
              <div className="laptop-screen">
                <LaptopScreen />
                <span className="screen-glare" />
              </div>
              <span className="laptop-camera" />
            </div>
            <div className="laptop-base">
              <div className="laptop-keys">
                {Array.from({ length: 52 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
              <span className="laptop-trackpad" />
            </div>
          </div>
          <div className="laptop-shadow" />
        </div>
        <div className="phone-float">
          <div className="phone">
            <span className="phone-notch" />
            <PhoneScreen />
            <span className="screen-glare" />
          </div>
        </div>
      </div>
      <ul className="device-features">
        <li>
          <Smartphone size={18} aria-hidden /> Online check-in
        </li>
        <li>
          <FileText size={18} aria-hidden /> Digital records
        </li>
        <li>
          <ReceiptText size={18} aria-hidden /> Payments &amp; receipts
        </li>
      </ul>
    </div>
  );
}
