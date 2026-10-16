// Rulings (choices a worker made that the plan didn't specify) and proof (the checks it ran and
// their results), from the workflow draft. Shown only when the item carries them; otherwise nothing.
import type { Extras } from '../../api/types';
import { InlineText } from '../../components/InlineText';
import { extraLines } from './thread';

export function ExtrasLines({ item }: { item: Extras }) {
  const rulings = extraLines(item.rulings);
  const proof = extraLines(item.proof);
  if (!rulings.length && !proof.length) return null;
  return (
    <dl className="extras">
      {rulings.length > 0 && (
        <>
          <dt title="Choices made along the way that the plan didn’t specify. Tell the Foreman if you want one undone.">Rulings</dt>
          {rulings.map((r, i) => <dd key={i}><InlineText text={r} /></dd>)}
        </>
      )}
      {proof.length > 0 && (
        <>
          <dt title="The checks that were run and what they returned.">Proof</dt>
          {proof.map((p, i) => <dd key={i} className="num"><InlineText text={p} /></dd>)}
        </>
      )}
    </dl>
  );
}
