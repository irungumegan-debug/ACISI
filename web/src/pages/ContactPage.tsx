import { FormEvent, useState } from 'react';
import { Clock, Mail, Phone, Send } from 'lucide-react';
import { Watermark } from '../components/Watermark';

const SUPPORT_EMAIL = 'acisi.help@gmail.com';

/**
 * Contact details plus a demo-request form. There's no backend for messages,
 * so the form opens the visitor's own email app with the message filled in.
 */
export function ContactPage() {
  const [name, setName] = useState('');
  const [clinic, setClinic] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const subject = `ACISI demo request${clinic.trim() ? ` – ${clinic.trim()}` : ''}`;
    const body = [`Name: ${name.trim()}`, `Clinic: ${clinic.trim() || '-'}`, `Phone: ${phone.trim() || '-'}`, '', message.trim()].join('\n');
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <div>
      <section className="page-hero" aria-labelledby="contact-title">
        <Watermark className="page-hero-watermark" />
        <div className="container page-hero-inner">
          <p className="eyebrow">Get in touch</p>
          <h1 id="contact-title" className="page-title">
            Let&apos;s talk about <span className="gold-text">your clinic.</span>
          </h1>
          <p className="page-lede">Questions, or want a demo? Reach us any of these ways.</p>
        </div>
      </section>

      <section className="band band-light" aria-label="Contact details and form">
        <div className="container contact-layout">
          <div className="contact-cards">
            <a className="contact-card" href={`mailto:${SUPPORT_EMAIL}`} data-reveal>
              <span className="icon-circle tone-gold">
                <Mail size={20} aria-hidden />
              </span>
              <span>
                <span className="contact-label">Email</span>
                <span className="contact-value">{SUPPORT_EMAIL}</span>
              </span>
            </a>
            <a className="contact-card" href="tel:+254746404155" data-reveal style={{ transitionDelay: '80ms' }}>
              <span className="icon-circle tone-teal">
                <Phone size={20} aria-hidden />
              </span>
              <span>
                <span className="contact-label">Phone</span>
                <span className="contact-value">+254 746 404 155</span>
              </span>
            </a>
            <div className="contact-card" data-reveal style={{ transitionDelay: '160ms' }}>
              <span className="icon-circle tone-blue">
                <Clock size={20} aria-hidden />
              </span>
              <span>
                <span className="contact-label">Support hours</span>
                <span className="contact-value">Mon–Fri, 8am–6pm EAT</span>
                <span className="contact-value">Sat–Sun, 10am–5pm EAT</span>
              </span>
            </div>
          </div>

          <form className="contact-form" onSubmit={handleSubmit} data-reveal>
            <h2>Book a demo</h2>
            <p className="form-help">This opens your email app with your message ready to send to {SUPPORT_EMAIL}.</p>
            <div className="form-grid">
              <label className="form-field">
                <span>Your name</span>
                <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </label>
              <label className="form-field">
                <span>Clinic name</span>
                <input value={clinic} onChange={(e) => setClinic(e.target.value)} autoComplete="organization" maxLength={100} />
              </label>
              <label className="form-field form-field-wide">
                <span>Phone number (optional)</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={20} />
              </label>
              <label className="form-field form-field-wide">
                <span>Message</span>
                <textarea
                  required
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1500}
                  placeholder="Tell us a little about your clinic and what you'd like to see."
                />
              </label>
            </div>
            <button className="btn btn-gold btn-lg btn-block" type="submit">
              <Send size={18} aria-hidden /> Write the email
            </button>
            {opened && (
              <p className="form-note" role="status">
                Your email app should open now. If it doesn&apos;t, email us at {SUPPORT_EMAIL}.
              </p>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
