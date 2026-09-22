export function AboutPage() {
  return (
    <div>
      <section className="mission-band">
        <div className="mission-inner">
          <p className="section-label">Our mission</p>
          <p className="mission-text">
            To bring patients and healthcare providers together in one seamless system, giving every person access
            to quality healthcare, and every provider the tools to deliver it.
          </p>
          <p className="section-label">Our vision</p>
          <p className="vision-text">
            To become the connective infrastructure healthcare runs on, the trusted bridge between patients and
            providers, wherever they are.
          </p>
        </div>
      </section>

      <section className="section">
        <p className="section-label">What we&apos;re building toward</p>
        <h2>Five goals behind everything we build.</h2>
        <div className="goals">
          <div className="goal">
            <p className="goal-letter">A</p>
            <p className="goal-word">Accessible</p>
            <p>Reachable on any phone, no smartphone required, ever.</p>
          </div>
          <div className="goal">
            <p className="goal-letter">C</p>
            <p className="goal-word">Comprehensive</p>
            <p>Check-in, consultation, prescription, and payment, one system.</p>
          </div>
          <div className="goal">
            <p className="goal-letter">I</p>
            <p className="goal-word">Inclusive</p>
            <p>Built for patients and providers equally, not one at the other&apos;s expense.</p>
          </div>
          <div className="goal">
            <p className="goal-letter">S</p>
            <p className="goal-word">Secure</p>
            <p>Access scoped to who needs it, every view logged, sharing by consent.</p>
          </div>
          <div className="goal">
            <p className="goal-letter">I</p>
            <p className="goal-word">Integrated</p>
            <p>One shared record connecting USSD, web, staff, and doctors.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
