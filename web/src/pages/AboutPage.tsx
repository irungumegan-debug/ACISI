import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Telescope } from 'lucide-react';
import { ValuesGrid } from '../components/Values';
import { Watermark } from '../components/Watermark';

export function AboutPage() {
  return (
    <div>
      <section className="page-hero" aria-labelledby="about-title">
        <Watermark className="page-hero-watermark" />
        <div className="container page-hero-inner">
          <p className="eyebrow">About ACISI</p>
          <h1 id="about-title" className="page-title">
            The bridge between <span className="gold-text">patients and clinics.</span>
          </h1>
          <p className="page-lede">Healthcare, within reach.</p>
        </div>
      </section>

      <section className="band band-light" aria-label="Mission and vision">
        <div className="container mv-grid">
          <article className="mv-card" data-reveal>
            <span className="icon-circle tone-gold">
              <Compass size={22} aria-hidden />
            </span>
            <p className="eyebrow">Our mission</p>
            <p className="mv-text">
              To bring patients and healthcare providers together in one seamless system, giving every person access to
              quality healthcare, and every provider the tools to deliver it.
            </p>
          </article>
          <article className="mv-card is-navy" data-reveal style={{ transitionDelay: '100ms' }}>
            <span className="icon-circle tone-gold-dark">
              <Telescope size={22} aria-hidden />
            </span>
            <p className="eyebrow">Our vision</p>
            <p className="mv-text">
              To become the connective infrastructure healthcare runs on, the trusted bridge between patients and
              providers, wherever they are.
            </p>
          </article>
        </div>
      </section>

      <section className="band band-light band-tight" aria-labelledby="story-title">
        <div className="container story" data-reveal>
          <p className="eyebrow">Why ACISI exists</p>
          <h2 id="story-title" className="section-title">
            A visit shouldn&apos;t depend on a paper file.
          </h2>
          <div className="story-body">
            <p>
              In many small clinics, a visit still runs on paper: a card at reception, a folder that may or may not turn
              up, and a prescription the patient has to keep safe until next time.
            </p>
            <p>
              ACISI puts that whole visit on one shared record. The patient checks in, the front desk sees them in the
              queue, the doctor writes notes and the prescription, and checkout records the payment and sends a short
              summary.
            </p>
            <p>
              We&apos;re a records and admin system, not a healthcare provider. Our job is to make the clinic&apos;s
              work easier, so its time goes to patients.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-navy" aria-labelledby="values-title">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">What ACISI stands for</p>
            <h2 id="values-title" className="section-title">
              Accessible. Comprehensive. Inclusive. Secure. Integrated.
            </h2>
          </div>
          <ValuesGrid />
          <div className="center-actions">
            <Link className="btn btn-gold btn-lg" to="/contact">
              Book a demo <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
