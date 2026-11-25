import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ShaVisitPanel } from '../components/ShaVisitPanel';
import { VitalSignsCard } from '../components/VitalSigns';

/** Front desk triage: start the visit with SHA (when connected) and record vital signs for a visit in the queue. */
export function VisitVitalsPage() {
  const { encounterId = '' } = useParams();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-3 text-sm">
        <Link to="/queue" className="inline-flex items-center gap-1.5 font-medium text-ink-500 hover:text-navy-900">
          <ArrowLeft size={16} aria-hidden /> Back to queue
        </Link>
      </p>
      <ShaVisitPanel encounterId={encounterId} />
      <VitalSignsCard encounterId={encounterId} editable />
    </div>
  );
}
