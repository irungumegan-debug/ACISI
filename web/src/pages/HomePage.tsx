import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  FileWarning,
  Hospital,
  LayoutDashboard,
  MessageSquareText,
  NotebookPen,
  Repeat,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  UserRound,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { HeroDevices } from '../components/HeroDevices';
import { ValuesGrid } from '../components/Values';
import { Watermark } from '../components/Watermark';

const STEPS = [
  { icon: Smartphone, title: 'Patient checks in', text: 'From the ACISI website on their phone, or at the front desk as a walk-in.' },
  { icon: LayoutDashboard, title: 'Front desk sees them', text: 'They join the clinic’s live queue, matched to the right department and doctor.' },
  { icon: NotebookPen, title: 'Doctor writes it up', text: 'Notes and the prescription go straight into the patient’s record.' },
  { icon: Wallet, title: 'Checkout and summary', text: 'Cash, card or M-Pesa at checkout, then a short visit summary by SMS.' },
];

const AUDIENCES = [
  {
    icon: UserRound,
    tone: 'teal',
    title: 'Patients',
    points: ['Check in before you arrive', 'Book appointments online', 'Your past visit summaries in one place'],
  },
  {
    icon: Stethoscope,
    tone: 'blue',
    title: 'Doctors',
    points: ['Your department’s queue at a glance', 'Notes and prescriptions, typed not written', 'Each consultation signed with your PIN'],
  },
  {
    icon: UsersRound,
    tone: 'gold',
    title: 'Clinic staff',
    points: ['Walk-ins and online check-ins in one queue', 'Bills, payments and receipts at checkout', 'A daily summary of what came in'],
  },
];

export function HomePage() {
  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <Watermark className="hero-watermark" />
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="pill">
              <Hospital size={15} aria-hidden /> Clinic management for Kenya
            </p>
            <h1 id="hero-title" className="hero-title">
              <span>One system</span>
              <span className="gold-text">for everyone.</span>
            </h1>
            <p className="hero-sub">
              Patients, doctors and clinic staff, connected in one place. Check-in, records, prescriptions and payments,
              without the paper files.
            </p>
            <p className="hero-motto">Healthcare, within reach.</p>
            <div className="hero-actions">
              <Link className="btn btn-gold btn-lg" to="/contact">
                Book a demo <ArrowRight size={18} aria-hidden />
              </Link>
              <Link className="btn btn-ghost-light btn-lg" to="/signup">
                Sign up
              </Link>
            </div>
          </div>
          <HeroDevices />
        </div>
      </section>

      <section className="band band-light" aria-labelledby="problem-title">
        <div className="container split">
          <div data-reveal>
            <p className="eyebrow">The problem</p>
            <h2 id="problem-title" className="section-title">
              Health records shouldn&apos;t live in an envelope.
            </h2>
            <p className="section-lede">
              Too often, patients carry paper files, results and old prescriptions from visit to visit. Files get lost,
              details get written down again, and the next doctor starts from scratch.
            </p>
          </div>
          <ul className="problem-list">
            {[
              { icon: FileWarning, title: 'Files go missing', text: 'Paper cards and folders get misplaced between visits.' },
              { icon: Repeat, title: 'The same questions, every time', text: 'Staff re-write details the clinic already has.' },
              { icon: ClipboardList, title: 'Queues on paper', text: 'Hard to see who is waiting, who is with the doctor and who has paid.' },
            ].map((item, i) => (
              <li key={item.title} className="problem-item" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="icon-circle tone-danger">
                  <item.icon size={20} aria-hidden />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band band-navy" aria-labelledby="how-title">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 id="how-title" className="section-title">
              From check-in to checkout, <span className="gold-text">on one record.</span>
            </h2>
          </div>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="step" data-reveal style={{ transitionDelay: `${i * 110}ms` }}>
                <span className="step-icon">
                  <step.icon size={24} aria-hidden />
                  <span className="step-num">{i + 1}</span>
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band band-light" aria-labelledby="who-title">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Who it&apos;s for</p>
            <h2 id="who-title" className="section-title">
              Built for everyone in the room.
            </h2>
          </div>
          <div className="audiences">
            {AUDIENCES.map((a, i) => (
              <article key={a.title} className={`audience-card tone-${a.tone}`} data-reveal style={{ transitionDelay: `${i * 100}ms` }}>
                <span className="audience-icon">
                  <a.icon size={26} aria-hidden />
                </span>
                <h3>{a.title}</h3>
                <ul>
                  {a.points.map((p) => (
                    <li key={p}>
                      <Sparkles size={14} aria-hidden /> {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-navy" aria-labelledby="values-title">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">What ACISI stands for</p>
            <h2 id="values-title" className="section-title">
              Five values behind everything we build.
            </h2>
          </div>
          <ValuesGrid />
        </div>
      </section>

      <section className="band band-light cta-wrap" aria-labelledby="cta-title">
        <div className="container">
          <div className="cta-band" data-reveal>
            <Watermark className="cta-watermark" />
            <div>
              <h2 id="cta-title">See ACISI in your clinic.</h2>
              <p>We&apos;ll walk you through check-in, the queue, records and checkout, using sample data.</p>
            </div>
            <div className="cta-actions">
              <Link className="btn btn-gold btn-lg" to="/contact">
                Book a demo <ArrowRight size={18} aria-hidden />
              </Link>
              <p className="cta-note">
                <MessageSquareText size={15} aria-hidden /> Or call +254 746 404 155
              </p>
            </div>
          </div>
          <p className="trust-note">
            <ShieldCheck size={15} aria-hidden /> ACISI is a records and admin system for clinics. It doesn&apos;t give
            medical advice.
          </p>
        </div>
      </section>
    </div>
  );
}
