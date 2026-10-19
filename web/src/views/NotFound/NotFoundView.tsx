// Not found (Play on): a #/ address that isn't a page. The Sleuth walks across with the magnifier
// once (under 1.5 s, then still) looking for it, says it isn't here, and offers the way back. Seeing it is a secret found. With
// Play mode Off the shell shows #/'s view instead, as it always did.
import { useEffect } from 'react';
import { hrefFor } from '../../app/router';
import { CrewMember } from '../../play/CrewMember';
import { useFindSecret } from '../../play/useSecret';
import { CREW_SIZE } from '../../play/crewSizes';

export function NotFoundView({ hash }: { hash: string }) {
  const find = useFindSecret();
  useEffect(() => { void find('sleuth-404'); }, [find]);
  return (
    <main className="pane pane-foreman" data-pane="not-found" aria-label="Page not found">
      <div className="foreman-column not-found">
        <h2 className="pane-title">Page not found</h2>
        <div className="not-found-scene">
          <span className="not-found-sleuth"><CrewMember type="feature-investigator" state="walking" size={CREW_SIZE.notFound} label="Sleuth, searching" animated={false} /></span>
        </div>
        <p>
          The Sleuth searched every corner for <code className="inline-code not-found-path">{hash}</code> and found only footprints.
          There’s no page at that address.
        </p>
        <p><a className="btn" href={hrefFor({ name: 'home' })} title="Back to the Workshop: your jobs and the Foreman.">Back to the Workshop</a></p>
      </div>
    </main>
  );
}
