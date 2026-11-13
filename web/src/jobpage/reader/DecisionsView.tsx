// Decisions in the reader (job page rebuild, Task 12; design brief "The job" rows): what the Foreman
// and Auto decided on his behalf, as a plain document. One item each: the decision, why, and where it
// was made with whether he has confirmed it. The rows are the body's meta (item id `decisions`), in
// either shape: the laptop's ({ id, decision, reason, where, confirmed }, status.json) or the website's
// decision log ({ id, question, choice, who, why }, lib/decisions.js), whose question shows above the
// choice. A body without rows (an older Starbase) shows its rendered list.

import { prepareDoc, Prose } from './Prose';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

interface Row { id?: unknown; decision?: unknown; chose?: unknown; choice?: unknown; question?: unknown; text?: unknown; reason?: unknown; why?: unknown; where?: unknown; confirmed?: unknown }

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function DecisionsView() {
  const { body, error } = useBody('decisions');
  const rows = Array.isArray(body?.meta.rows) ? (body.meta.rows as Row[]).filter((r) => r && typeof r === 'object') : null;
  return (
    <ReaderBody view="decisions" place="decisions:decisions" ready={body !== null}>
      {!body ? <NotLoaded error={error} />
        : !rows ? <Prose prepared={prepareDoc(body)} />
          : rows.length === 0 ? <p className="jp2-notyet">Nothing was decided for you on this job.</p>
            : (
              <ul className="jp2-prose jp2-decs">
                {rows.map((r, i) => {
                  const id = text(r.id);
                  const why = text(r.reason) ?? text(r.why);
                  const where = text(r.where);
                  const confirmed = typeof r.confirmed === 'boolean' ? (r.confirmed ? 'confirmed' : 'not confirmed yet') : null;
                  const facts = [where, confirmed].filter(Boolean).join(' · ');
                  const question = text(r.question);
                  return (
                    <li key={id ?? i} className="jp2-dec">
                      {question && <p className="jp2-dec-q">{question}</p>}
                      <p className="jp2-dec-what">{id && <span className="jp2-dim">{id} · </span>}{text(r.decision) ?? text(r.chose) ?? text(r.choice) ?? text(r.text) ?? 'A decision'}</p>
                      {why && <p className="jp2-dec-why">{why}</p>}
                      {facts && <p className="jp2-dec-facts">{facts}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
    </ReaderBody>
  );
}
