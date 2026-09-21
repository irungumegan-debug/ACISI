import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div id="page-landing">
      <section className="hero">
        <p className="motto">Healthcare, within reach.</p>
        <h1>The healthcare system every patient can reach, and every provider can run on.</h1>
        <p className="hero-sub">
          ACISI connects patients and clinics on one system, so anyone can check in from any phone, feature or
          smartphone, with records and prescriptions that follow the patient, not the paperwork.
        </p>
        <div className="hero-actions">
          <Link className="btn-gold" to="/signup">
            Get started
          </Link>
          <Link className="btn-outline" to="/about">
            Learn more
          </Link>
        </div>
      </section>

      <section className="section" id="roles-preview">
        <p className="section-label">Built for everyone in the room</p>
        <h2>One system. Every patient, every front desk, every doctor, working from the same source of truth.</h2>
        <p style={{ fontSize: 15, color: 'var(--ink-dim)', maxWidth: '56ch', lineHeight: 1.65 }}>
          No one waits on paperwork that hasn&apos;t caught up, and no one works from a record someone else
          can&apos;t see. ACISI is built so the whole clinic, and every patient who walks in, is finally on the same
          page.
        </p>
      </section>
    </div>
  );
}
