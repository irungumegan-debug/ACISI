import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, LucideIcon, Stethoscope, UserRound, UsersRound } from 'lucide-react';
import { Logo } from './Logo';
import { Watermark } from './Watermark';

/** Navy page with the faint "A" watermark that frames login and signup. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <Watermark className="auth-watermark" />
      <div className="auth-wrap">
        <Link className="auth-brand" to="/" aria-label="ACISI home">
          <Logo size={40} />
        </Link>
        <div className="auth-card">{children}</div>
        <LegalLinks />
      </div>
    </div>
  );
}

/** Small Privacy Notice / Terms of Service links under the login and signup card. */
export function LegalLinks() {
  return (
    <nav className="auth-legal" aria-label="Legal">
      <Link to="/privacy">Privacy Notice</Link>
      <Link to="/terms">Terms of Service</Link>
    </nav>
  );
}

export type RoleTone = 'teal' | 'blue' | 'emerald' | 'gold';

export const ROLE_ICONS: Record<'patient' | 'doctor' | 'staff' | 'clinic', { icon: LucideIcon; tone: RoleTone }> = {
  patient: { icon: UserRound, tone: 'teal' },
  doctor: { icon: Stethoscope, tone: 'blue' },
  staff: { icon: UsersRound, tone: 'emerald' },
  clinic: { icon: Building2, tone: 'gold' },
};

/** A large selectable role card: icon in the role's colour, title, hint; gold when hovered, focused or pressed. */
export function RoleCard({ role, title, sub, onPick }: { role: keyof typeof ROLE_ICONS; title: string; sub: string; onPick: () => void }) {
  const { icon: Icon, tone } = ROLE_ICONS[role];
  return (
    <button type="button" className={`role-card tone-${tone}`} onClick={onPick}>
      <span className="role-card-icon">
        <Icon size={24} aria-hidden />
      </span>
      <span className="role-card-text">
        <span className="role-card-title">{title}</span>
        <span className="role-card-sub">{sub}</span>
      </span>
      <ChevronRight className="role-card-chev" size={20} aria-hidden />
    </button>
  );
}
