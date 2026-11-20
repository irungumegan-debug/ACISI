/**
 * Turns the Shared Health Record's answer (a FHIR searchset bundle, passed
 * through by DHA) into a short list for the doctor's screen. Shown only,
 * never stored in ACISI.
 */

export interface NationalRecordItem {
  kind: 'Visit' | 'Diagnosis' | 'Medicine' | 'Allergy' | 'Result' | 'Immunisation';
  /** ISO date-time or date, when known. */
  date: string | null;
  title: string;
  detail: string | null;
  /** Facility as DHA names it (display, or the FR code), when given. */
  facility: string | null;
}

type R = Record<string, unknown>;

const KIND: Record<string, NationalRecordItem['kind']> = {
  Encounter: 'Visit',
  Condition: 'Diagnosis',
  MedicationRequest: 'Medicine',
  AllergyIntolerance: 'Allergy',
  Observation: 'Result',
  Immunization: 'Immunisation',
};

function resources(data: unknown): R[] {
  const out: R[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(visit);
    const o = v as R;
    if (typeof o.resourceType === 'string' && o.resourceType !== 'Bundle' && KIND[o.resourceType]) {
      out.push(o);
      return;
    }
    for (const val of Object.values(o)) visit(val);
  };
  visit(data);
  return out;
}

const text = (cc: unknown): string | null => {
  const c = cc as { text?: string; coding?: { display?: string; code?: string }[] } | undefined;
  return c?.text ?? c?.coding?.find((x) => x.display)?.display ?? c?.coding?.[0]?.code ?? null;
};

const refDisplay = (r: unknown): string | null => {
  const ref = r as { display?: string; reference?: string } | undefined;
  return ref?.display ?? (ref?.reference?.startsWith('Organization/') ? ref.reference.slice(13) : null);
};

function toItem(r: R): NationalRecordItem | null {
  const kind = KIND[r.resourceType as string];
  if (!kind) return null;
  switch (r.resourceType) {
    case 'Encounter': {
      const period = r.period as { start?: string } | undefined;
      return { kind, date: period?.start ?? null, title: text((r.serviceType as unknown) ?? (r.type as unknown[] | undefined)?.[0]) ?? 'Visit', detail: text((r.reasonCode as unknown[] | undefined)?.[0]), facility: refDisplay(r.serviceProvider) };
    }
    case 'Condition': {
      const code = (r.code as { coding?: { code?: string }[] } | undefined)?.coding?.[0]?.code;
      return { kind, date: (r.recordedDate as string) ?? (r.onsetDateTime as string) ?? null, title: text(r.code) ?? 'Diagnosis', detail: code ?? null, facility: null };
    }
    case 'MedicationRequest': {
      const dosage = (r.dosageInstruction as { text?: string }[] | undefined)?.[0]?.text ?? null;
      return { kind, date: (r.authoredOn as string) ?? null, title: text(r.medicationCodeableConcept) ?? 'Medicine', detail: dosage, facility: null };
    }
    case 'AllergyIntolerance': {
      const reaction = text((r.reaction as { manifestation?: unknown[] }[] | undefined)?.[0]?.manifestation?.[0]);
      return { kind, date: (r.recordedDate as string) ?? null, title: text(r.code) ?? 'Allergy', detail: reaction, facility: null };
    }
    case 'Observation': {
      const q = r.valueQuantity as { value?: number; unit?: string } | undefined;
      const value = (r.valueString as string) ?? (q?.value !== undefined ? `${q.value} ${q.unit ?? ''}`.trim() : null) ?? text(r.valueCodeableConcept);
      return { kind, date: (r.effectiveDateTime as string) ?? (r.issued as string) ?? null, title: text(r.code) ?? 'Result', detail: value, facility: null };
    }
    case 'Immunization':
      return { kind, date: (r.occurrenceDateTime as string) ?? null, title: text(r.vaccineCode) ?? 'Immunisation', detail: null, facility: null };
    default:
      return null;
  }
}

export function summariseNationalRecords(data: unknown, opts: { excludeEncounterId?: string } = {}): NationalRecordItem[] {
  const items: NationalRecordItem[] = [];
  for (const r of resources(data)) {
    // Skip what this visit itself sent.
    if (opts.excludeEncounterId) {
      if (r.resourceType === 'Encounter' && r.id === opts.excludeEncounterId) continue;
      if ((r.encounter as { reference?: string } | undefined)?.reference === `Encounter/${opts.excludeEncounterId}`) continue;
    }
    const item = toItem(r);
    if (item) items.push(item);
  }
  return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 200);
}
