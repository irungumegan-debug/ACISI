import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2, X } from 'lucide-react';
import { AllergyConflict, api, MedicineHit, PrescriptionLine, PrescriptionOptions } from '../lib/api';
import { btn, field } from './ui';
import { plural } from '../lib/plural';

export const MAX_LINES = 15;

/** A line being edited: numbers as text so the boxes can be empty while typing. */
export interface DraftLine {
  key: number;
  productCode: string | null;
  drugName: string;
  doseValue: string;
  doseUnit: string;
  route: string;
  frequency: string;
  durationDays: string;
  quantity: string;
  /** True once the doctor typed a quantity themselves (stop auto-filling it). */
  quantityEdited: boolean;
  instructionCodes: string[];
  instructions: string;
  allergyOverrideReason: string;
}

let optionsPromise: Promise<PrescriptionOptions> | null = null;

/** The prescription choices (DHA routes, units, instructions), fetched once per page load. */
export function usePrescriptionOptions(): PrescriptionOptions | null {
  const [options, setOptions] = useState<PrescriptionOptions | null>(null);
  useEffect(() => {
    optionsPromise ??= api.prescriptionOptions();
    let cancelled = false;
    optionsPromise
      .then((o) => !cancelled && setOptions(o))
      .catch(() => {
        optionsPromise = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

/** How a line reads on the sign screen. */
export function describeLine(l: DraftLine, options: PrescriptionOptions | null): string {
  const u = options?.doseUnits.find((x) => x.code === l.doseUnit);
  const unit = (Number(l.doseValue) === 1 ? u?.one : u?.name) ?? '';
  const freq = options?.frequencies.find((f) => f.code === l.frequency)?.name ?? l.frequency;
  const route = options?.routes.find((r) => r.code === l.route)?.name ?? '';
  const days = positive(l.durationDays);
  const qty = positive(l.quantity);
  const notes = [...l.instructionCodes.map((c) => options?.instructions.find((i) => i.code === c)?.name ?? c), l.instructions.trim()].filter(Boolean);
  return `${l.drugName}: ${l.doseValue} ${unit} ${freq}${days ? ` for ${plural(days, 'day')}` : ''}${route && l.route !== 'RT10025' ? ` (${route})` : ''}${qty ? `, give ${qty}` : ''}${notes.length ? `. ${notes.join('. ')}` : ''}`;
}

let nextKey = 1;
export function emptyLine(): DraftLine {
  return {
    key: nextKey++,
    productCode: null,
    drugName: '',
    doseValue: '1',
    doseUnit: 'UM10415',
    route: 'RT10025',
    frequency: 'TDS',
    durationDays: '',
    quantity: '',
    quantityEdited: false,
    instructionCodes: [],
    instructions: '',
    allergyOverrideReason: '',
  };
}

const positive = (s: string): number | null => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Suggested quantity: dose x times a day x days, when all are known. */
function autoQuantity(l: DraftLine, options: PrescriptionOptions | null): string {
  const perDay = options?.frequencies.find((f) => f.code === l.frequency)?.perDay ?? null;
  const dose = positive(l.doseValue);
  const days = positive(l.durationDays);
  if (l.frequency === 'STAT' && dose) return String(dose);
  return perDay && dose && days ? String(Math.ceil(dose * perDay * days)) : '';
}

/** Problems that stop signing, per line (null when the line is complete). */
export function lineProblem(l: DraftLine): string | null {
  if (!l.productCode && l.drugName.trim().length < 2) return 'Choose a medicine';
  if (!positive(l.doseValue)) return 'Enter the dose';
  if (l.durationDays.trim() && !(Number.isInteger(Number(l.durationDays)) && Number(l.durationDays) >= 1 && Number(l.durationDays) <= 365))
    return 'Days must be a whole number from 1 to 365';
  return null;
}

export function toPrescriptionLine(l: DraftLine): PrescriptionLine {
  const quantity = positive(l.quantity);
  return {
    productCode: l.productCode,
    drugName: l.productCode ? null : l.drugName.trim(),
    doseValue: Number(l.doseValue),
    doseUnit: l.doseUnit,
    route: l.route,
    frequency: l.frequency,
    durationDays: positive(l.durationDays),
    quantity,
    quantityUnit: quantity ? l.doseUnit : null,
    instructionCodes: l.instructionCodes,
    instructions: l.instructions.trim() || null,
    allergyOverrideReason: l.allergyOverrideReason.trim() || null,
  };
}

function MedicinePicker({ line, onPick, onType }: { line: DraftLine; onPick: (m: MedicineHit) => void; onType: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicineHit[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .searchMedicines(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            setActive(0);
          }
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  if (line.productCode || line.drugName) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm ring-1 ring-teal-200">
        <span className="flex-1 font-semibold text-navy-900">
          {line.drugName}
          {line.productCode ? (
            <span className="ml-2 font-mono text-xs font-normal text-teal-800">{line.productCode}</span>
          ) : (
            <span className="ml-2 text-xs font-normal text-amber-800">not on DHA&apos;s list</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            onType('');
            setQuery('');
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="rounded p-0.5 text-ink-500 hover:bg-teal-100 hover:text-navy-900"
          aria-label={`Change medicine ${line.drugName}`}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    );
  }

  const open = query.trim().length >= 2;
  return (
    <div className="relative">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Medicine"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const m = results[active];
            if (m) onPick(m);
            else onType(query.trim());
          }
        }}
        placeholder='Search medicine, e.g. "amoxicillin 500" or "paracetamol syrup"'
        className={`${field.input} pl-9`}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Medicines" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-raised">
          {results.map((m, i) => (
            <li
              key={m.code}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer gap-3 px-3 py-2 text-sm ${i === active ? 'bg-cream-100' : ''}`}
            >
              <span className="text-ink-700">{m.name}</span>
              <span className="ml-auto flex-none font-mono text-xs text-ink-400">{m.code}</span>
            </li>
          ))}
          <li
            role="option"
            aria-selected={active === results.length}
            onMouseDown={(e) => {
              e.preventDefault();
              onType(query.trim());
            }}
            onMouseEnter={() => setActive(results.length)}
            className={`cursor-pointer border-t border-slate-100 px-3 py-2 text-sm text-ink-500 ${active === results.length ? 'bg-cream-100' : ''}`}
          >
            Use &ldquo;{query.trim()}&rdquo; (not on DHA&apos;s list)
          </li>
        </ul>
      )}
    </div>
  );
}

const small = `${field.input} py-2`;

function LineCard({
  line,
  index,
  options,
  conflicts,
  onChange,
  onRemove,
  canRemove,
}: {
  line: DraftLine;
  index: number;
  options: PrescriptionOptions | null;
  conflicts: AllergyConflict[];
  onChange: (l: DraftLine) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const set = (patch: Partial<DraftLine>) => {
    const next = { ...line, ...patch };
    if (!next.quantityEdited) next.quantity = autoQuantity(next, options);
    onChange(next);
  };
  const id = `rx-${line.key}`;
  const instructionsLeft = options?.instructions.filter((i) => !line.instructionCodes.includes(i.code)) ?? [];

  return (
    <li className={`rounded-2xl border p-4 ${conflicts.length ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">Medicine {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" aria-label={`Remove medicine ${index + 1}`}>
            <Trash2 size={14} aria-hidden /> Remove
          </button>
        )}
      </div>
      <MedicinePicker
        line={line}
        onPick={(m) =>
          set({
            productCode: m.code,
            drugName: m.name,
            route: m.suggestedRoute && options?.routes.some((r) => r.code === m.suggestedRoute) ? m.suggestedRoute : line.route,
            doseUnit: m.suggestedDoseUnit && options?.doseUnits.some((u) => u.code === m.suggestedDoseUnit) ? m.suggestedDoseUnit : line.doseUnit,
            allergyOverrideReason: '',
          })
        }
        onType={(name) => set({ productCode: null, drugName: name, allergyOverrideReason: '' })}
      />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={field.label}>Dose</span>
          <input id={`${id}-dose`} inputMode="decimal" value={line.doseValue} onChange={(e) => set({ doseValue: e.target.value })} className={small} />
        </label>
        <label className="block">
          <span className={field.label}>Unit</span>
          <select value={line.doseUnit} onChange={(e) => set({ doseUnit: e.target.value })} className={small}>
            {options?.doseUnits.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={field.label}>For (days)</span>
          <input inputMode="numeric" value={line.durationDays} onChange={(e) => set({ durationDays: e.target.value })} placeholder="e.g. 5" className={small} />
        </label>

        <label className="block">
          <span className={field.label}>Quantity to give</span>
          <input
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onChange({ ...line, quantity: e.target.value, quantityEdited: true })}
            placeholder="optional"
            className={small}
          />
        </label>
        <label className="col-span-2 block">
          <span className={field.label}>How often</span>
          <select value={line.frequency} onChange={(e) => set({ frequency: e.target.value })} className={small}>
            {options?.frequencies.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className={field.label}>Route</span>
          <select value={line.route} onChange={(e) => set({ route: e.target.value })} className={small}>
            {options?.routes.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block sm:col-span-4">
          <span className={field.label}>Add an instruction</span>
          <select
            value=""
            onChange={(e) => e.target.value && set({ instructionCodes: [...line.instructionCodes, e.target.value].slice(0, 5) })}
            className={small}
            disabled={line.instructionCodes.length >= 5}
          >
            <option value="">Choose…</option>
            {instructionsLeft.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {line.instructionCodes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Instructions">
          {line.instructionCodes.map((c) => (
            <li key={c} className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-1 text-xs text-ink-700 ring-1 ring-slate-200">
              {options?.instructions.find((i) => i.code === c)?.name ?? c}
              <button type="button" onClick={() => set({ instructionCodes: line.instructionCodes.filter((x) => x !== c) })} aria-label="Remove instruction">
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block">
        <span className={field.label}>Note for this medicine (optional)</span>
        <input value={line.instructions} maxLength={300} onChange={(e) => set({ instructions: e.target.value })} className={small} />
      </label>
      {conflicts.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-red-300 bg-white p-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-red-800">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
            Allergy warning
          </p>
          <ul className="ml-6 mt-1 list-disc text-sm text-red-800">
            {[...new Set(conflicts.map((c) => c.reason))].map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <label className="mt-2 block">
            <span className={field.label}>To prescribe it anyway, give your reason (or change the medicine)</span>
            <input
              value={line.allergyOverrideReason}
              maxLength={300}
              onChange={(e) => onChange({ ...line, allergyOverrideReason: e.target.value })}
              placeholder="e.g. Allergy was a mild rash; benefit outweighs risk; patient informed"
              className={small}
            />
          </label>
        </div>
      )}
    </li>
  );
}

/**
 * The prescription: one card per medicine, from DHA's Kenya medicines list
 * (or typed when not listed), with an allergy check as the doctor writes.
 */
export function PrescriptionEditor({
  encounterId,
  lines,
  onChange,
  conflicts,
  onConflicts,
}: {
  encounterId: string;
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  conflicts: AllergyConflict[];
  onConflicts: (c: AllergyConflict[]) => void;
}) {
  const options = usePrescriptionOptions();

  // Re-check allergies whenever the chosen medicines change.
  const names = lines.map((l) => `${l.productCode ?? ''}|${l.drugName}`).join('\n');
  useEffect(() => {
    const items = lines.map((l) => ({ productCode: l.productCode, drugName: l.productCode ? null : l.drugName || null }));
    if (!items.some((i) => i.productCode || i.drugName)) {
      onConflicts([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .checkPrescription(encounterId, items)
        .then((r) => !cancelled && onConflicts(r.allergyConflicts))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, encounterId]);

  return (
    <div>
      <ol className="space-y-3">
        {lines.map((l, i) => (
          <LineCard
            key={l.key}
            line={l}
            index={i}
            options={options}
            conflicts={conflicts.filter((c) => c.index === i)}
            onChange={(next) => onChange(lines.map((x) => (x.key === l.key ? next : x)))}
            onRemove={() => onChange(lines.filter((x) => x.key !== l.key))}
            canRemove={lines.length > 1}
          />
        ))}
      </ol>
      {lines.length < MAX_LINES && (
        <button type="button" onClick={() => onChange([...lines, emptyLine()])} className={`${btn.secondary} mt-3`}>
          <Plus size={16} aria-hidden /> Add another medicine
        </button>
      )}
      <p className="mt-2 text-xs text-ink-500">
        Medicines from DHA&apos;s Kenya ePrescription list (Pharmacy and Poisons Board). The allergy check covers the patient&apos;s recorded
        allergies, brand names and drug groups (e.g. penicillins); it doesn&apos;t check cross-reactions between groups or allergies hidden
        at other clinics. Your judgement decides.
      </p>
    </div>
  );
}
