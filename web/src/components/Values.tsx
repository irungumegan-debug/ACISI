import { Accessibility, Blocks, HeartHandshake, Layers, ShieldCheck } from 'lucide-react';

/** The five ACISI values, shared by Home and About. */
export const VALUES = [
  { letter: 'A', word: 'Accessible', icon: Accessibility, tone: 'teal', text: 'Check in from any phone browser, with simple screens that work on limited data.' },
  { letter: 'C', word: 'Comprehensive', icon: Layers, tone: 'gold', text: 'Check-in, consultation, prescription and payment, in one system.' },
  { letter: 'I', word: 'Inclusive', icon: HeartHandshake, tone: 'rose', text: 'Built for patients and providers equally, not one at the other’s expense.' },
  { letter: 'S', word: 'Secure', icon: ShieldCheck, tone: 'emerald', text: 'Access scoped to who needs it, sensitive actions logged, sharing by consent.' },
  { letter: 'I', word: 'Integrated', icon: Blocks, tone: 'blue', text: 'One shared record connecting patients, the front desk and doctors.' },
] as const;

export function ValuesGrid() {
  return (
    <div className="values">
      {VALUES.map((v, i) => (
        <article key={v.word} className={`value-card tone-${v.tone}`} data-reveal style={{ transitionDelay: `${i * 70}ms` }}>
          <span className="value-icon">
            <v.icon size={22} aria-hidden />
          </span>
          <p className="value-letter" aria-hidden>
            {v.letter}
          </p>
          <h3>{v.word}</h3>
          <p>{v.text}</p>
        </article>
      ))}
    </div>
  );
}
