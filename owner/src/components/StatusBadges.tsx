import { EncounterStatus } from '../lib/api';
import { Badge } from './ui';

const ENCOUNTER_LABELS: Record<EncounterStatus, { label: string; tone: 'amber' | 'blue' | 'green' | 'stone' }> = {
  WAITING: { label: 'Waiting', tone: 'amber' },
  IN_CONSULTATION: { label: 'With doctor', tone: 'blue' },
  READY_FOR_CHECKOUT: { label: 'Checkout', tone: 'blue' },
  DONE: { label: 'Done', tone: 'green' },
};

export function EncounterBadge({ status }: { status: EncounterStatus }) {
  const { label, tone } = ENCOUNTER_LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DeletedBadge() {
  return <Badge tone="red">Deleted</Badge>;
}
