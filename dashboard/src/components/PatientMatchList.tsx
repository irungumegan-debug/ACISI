import type { ReactNode } from 'react';
import type { PatientMatch } from '../lib/api';
import { Avatar } from './ui';

const SEX_LABEL: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other', UNKNOWN: '' };

/** "15 Mar 1990", "born 1990" (year only known, or not this clinic's patient yet), or "No date of birth on file". */
export function describeBirth(p: PatientMatch): string {
  if (p.dateOfBirth && !p.dateOfBirthEstimated) {
    return `Born ${new Date(`${p.dateOfBirth}T00:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  }
  if (p.birthYear) return `Born ${p.birthYear}`;
  return 'No date of birth on file';
}

/**
 * The patients found for a phone number or ACISI ID. A phone can hold
 * several people (a parent and children), so staff always pick one.
 * `action` renders the button(s) for each row.
 */
export function PatientMatchList({ patients, action }: { patients: PatientMatch[]; action: (p: PatientMatch) => ReactNode }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {patients.map((p) => (
        <li key={p.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={p.name} />
            <div className="min-w-0">
              <p className="truncate font-medium text-navy-900">{p.name}</p>
              <p className="text-sm text-ink-500">
                {p.patientCode} · {[SEX_LABEL[p.sex], describeBirth(p)].filter(Boolean).join(' · ')}
              </p>
              {!p.linkedToClinic && <p className="text-xs text-ink-500">Not yet a patient at your clinic — ask for their full date of birth.</p>}
            </div>
          </div>
          <div className="flex flex-none gap-2">{action(p)}</div>
        </li>
      ))}
    </ul>
  );
}
