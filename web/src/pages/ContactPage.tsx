export function ContactPage() {
  return (
    <section className="section">
      <p className="section-label">Get in touch</p>
      <h2>Contact us.</h2>
      <p style={{ fontSize: 15, color: 'var(--ink-dim)', maxWidth: '56ch', lineHeight: 1.65 }}>
        Questions about ACISI, or want to bring your clinic on board? Reach us any of these ways.
      </p>

      <div className="contact-grid">
        <div className="contact-card">
          <p className="label">Email</p>
          <p className="value">acisi.help@gmail.com</p>
        </div>
        <div className="contact-card">
          <p className="label">Phone</p>
          <p className="value">+254 746 404 155</p>
        </div>
        <div className="contact-card">
          <p className="label">Support hours</p>
          <p className="value">Mon–Fri, 8am–6pm EAT</p>
          <p className="value">Sat–Sun, 10am–5pm EAT</p>
        </div>
      </div>
    </section>
  );
}
