import type { PatientIdentity, PatientIdType } from '../lib/api';

export const ID_TYPE_OPTIONS: { value: PatientIdType; label: string }[] = [
  { value: 'NATIONAL_ID', label: 'National ID' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'ALIEN_ID', label: 'Alien ID' },
];

export const EMPTY_IDENTITY: PatientIdentity = { idType: '', idNumber: '', nextOfKinName: '', nextOfKinPhone: '' };

/**
 * Optional ID document and next of kin, shown at web check-in inside a
 * collapsed "Add your ID and next of kin" section. Only what's filled in is
 * saved; leaving a field empty never removes what's on file.
 */
export function IdentityFields({ value, onChange }: { value: PatientIdentity; onChange: (next: PatientIdentity) => void }) {
  const set = (patch: Partial<PatientIdentity>) => onChange({ ...value, ...patch });
  return (
    <div className="identity-fields">
      <div className="field">
        <label htmlFor="id-type">ID document</label>
        <select id="id-type" value={value.idType} onChange={(e) => set({ idType: e.target.value as PatientIdType | '' })}>
          <option value="">Choose…</option>
          {ID_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="id-number">ID number</label>
        <input
          id="id-number"
          type="text"
          autoComplete="off"
          inputMode={value.idType === 'NATIONAL_ID' ? 'numeric' : 'text'}
          maxLength={40}
          placeholder={value.idType === 'NATIONAL_ID' ? 'e.g. 12345678' : ''}
          value={value.idNumber}
          onChange={(e) => set({ idNumber: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="nok-name">Next of kin: full name</label>
        <input id="nok-name" type="text" autoComplete="off" maxLength={100} value={value.nextOfKinName} onChange={(e) => set({ nextOfKinName: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="nok-phone">Next of kin: phone number</label>
        <input
          id="nok-phone"
          type="tel"
          autoComplete="off"
          maxLength={20}
          placeholder="07XX XXX XXX"
          value={value.nextOfKinPhone}
          onChange={(e) => set({ nextOfKinPhone: e.target.value })}
        />
      </div>
    </div>
  );
}
