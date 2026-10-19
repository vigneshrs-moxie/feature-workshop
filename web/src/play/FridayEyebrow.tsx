// A git push permission card on a Friday from 4pm (local time): the Locksmith raises an eyebrow,
// under the card's buttons (never between you and them). Looking only: it never changes, delays or
// suggests a decision. Seeing it is a secret found. Nothing with Play mode Off.
import { useEffect } from 'react';
import type { Permission } from '../api/types';
import { CrewMember } from './CrewMember';
import { isFridayPush } from './eggs';
import { usePlayIfAny } from './usePlay';
import { useFindSecret } from './useSecret';
import { CREW_SIZE } from './crewSizes';

export function FridayEyebrow({ permission, now }: { permission: Permission; now: Date }) {
  const play = usePlayIfAny();
  const find = useFindSecret();
  const show = Boolean(play?.on) && isFridayPush(permission, now);
  useEffect(() => { if (show) void find('friday-push'); }, [show, find]);
  if (!show) return null;
  return (
    <p className="perm-friday muted" title="It’s Friday afternoon. The Locksmith only looks; the decision is yours, as always.">
      <span className="perm-friday-face" aria-hidden="true">
        <CrewMember type="feature-review-permissions" state="waiting" size={CREW_SIZE.friday} label="" animated={false} />
        <span className="perm-friday-brow" />
      </span>
      A push on a Friday after 4pm. The Locksmith raises an eyebrow.
    </p>
  );
}
