import { ActivityEntry } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';
import { Badge } from './ui';

const ACTOR_TONES = { OWNER: 'amber', STAFF: 'blue', PATIENT: 'green', SYSTEM: 'stone' } as const;

export function ActivityList({ entries, showEntity }: { entries: ActivityEntry[]; showEntity: boolean }) {
  return (
    <ul className="divide-y divide-stone-100">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-4">
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-stone-500 sm:w-40">{formatDateTime(e.createdAt)}</span>
          <span className="min-w-0 text-sm text-stone-700">
            <Badge tone={ACTOR_TONES[e.actorType]}>{humanize(e.actorType)}</Badge>{' '}
            <span className="font-medium text-stone-900">{e.actorLabel}</span> — {humanize(e.action)}
            {showEntity && e.entityId && (
              <span className="text-stone-500">
                {' '}
                · {e.entityType} <span className="font-mono text-xs">{e.entityId}</span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
