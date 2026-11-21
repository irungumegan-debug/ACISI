import type { PatientIdentity, PatientIdType } from '../lib/api';
import { field } from './ui';

export const ID_TYPE_OPTIONS: { value: PatientIdType; label: string }[] = [
  { value: 'NATIONAL_ID', label: 'National ID' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'ALIEN_ID', label: 'Alien ID' },
];

export const ID_TYPE_LABEL: Record<PatientIdType, string> = Object.fromEntries(ID_TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<
  PatientIdType,
  string
>;

export const EMPTY_IDENTITY: PatientIdentity = { idType: '', idNumber: '', nextOfKinName: '', nextOfKinPhone: '' };

const input = `${field.input} text-base sm:text-[15px]`;

/** Optional ID document (with type) and next of kin — used at walk-in check-in and on the patient's page. */
export function IdentityFields({ value, onChange, idPrefix }: { value: PatientIdentity; onChange: (next: PatientIdentity) => void; idPrefix: string }) {
  const set = (patch: Partial<PatientIdentity>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-id-type`} className={field.label}>
          ID document
        </label>
        <select id={`${idPrefix}-id-type`} value={value.idType} onChange={(e) => set({ idType: e.target.value as PatientIdType | '' })} className={input}>
          <option value="">None / not given</option>
          {ID_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-id-number`} className={field.label}>
          ID number
        </label>
        <input
          id={`${idPrefix}-id-number`}
          autoComplete="off"
          maxLength={40}
          inputMode={value.idType === 'NATIONAL_ID' ? 'numeric' : 'text'}
          value={value.idNumber}
          onChange={(e) => set({ idNumber: e.target.value })}
          className={input}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-nok-name`} className={field.label}>
          Next of kin: full name
        </label>
        <input
          id={`${idPrefix}-nok-name`}
          autoComplete="off"
          maxLength={100}
          value={value.nextOfKinName}
          onChange={(e) => set({ nextOfKinName: e.target.value })}
          className={input}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-nok-phone`} className={field.label}>
          Next of kin: phone
        </label>
        <input
          id={`${idPrefix}-nok-phone`}
          type="tel"
          autoComplete="off"
          maxLength={20}
          placeholder="07XX XXX XXX"
          value={value.nextOfKinPhone}
          onChange={(e) => set({ nextOfKinPhone: e.target.value })}
          className={input}
        />
      </div>
    </div>
  );
}
