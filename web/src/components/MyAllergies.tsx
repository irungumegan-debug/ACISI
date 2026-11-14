import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, MyAllergy } from '../lib/api';

const SEVERITY: Record<MyAllergy['severity'], string> = { MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe', UNKNOWN: 'severity not recorded' };

/** The patient's allergies as recorded by their doctors (read-only). */
export function MyAllergies() {
  const [items, setItems] = useState<MyAllergy[] | null>(null);
  useEffect(() => {
    api
      .getMyAllergies()
      .then((r) => setItems(r.allergies.filter((a) => !a.removedAt)))
      .catch(() => setItems([]));
  }, []);
  if (!items) return null;
  return (
    <div className="panel">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
        <AlertTriangle size={20} aria-hidden /> My allergies
      </h2>
      {items.length === 0 ? (
        <p>No allergies recorded. If you have any, tell your doctor at your next visit.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {items.map((a) => (
            <li key={a.id}>
              <b>{a.substance}</b> ({SEVERITY[a.severity]}){a.reaction ? `: ${a.reaction}` : ''}. Recorded at {a.clinicName}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
