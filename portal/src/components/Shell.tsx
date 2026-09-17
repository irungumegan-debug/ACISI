import { NavLink } from 'react-router-dom';
import { ReactNode } from 'react';

const tabClass = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive ? 'bg-gold-500 font-semibold text-navy-900' : 'text-navy-100 hover:text-white'
  }`;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-navy-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold text-white">ACISI</span>
          <nav className="flex gap-2">
            <NavLink to="/checkin" className={tabClass}>
              Check in
            </NavLink>
            <NavLink to="/records" className={tabClass}>
              My records
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  );
}
