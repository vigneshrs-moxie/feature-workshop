// The Foreman's model in words ("Opus 5.5"): fixed once the job has a session (Change model… in
// the job menu starts the job again), so it is known only from then. Before the job has started
// it is null: nothing is shown. A model the list doesn't name shows as its id.
import type { JobDetail, ModelChoice } from '../../api/types';

export function foremanModel(detail: JobDetail | null | undefined, models: readonly ModelChoice[] | null | undefined): string | null {
  const id = detail?.drive?.sessionId ? detail.drive.model ?? null : null;
  if (!id) return null;
  return models?.find((m) => m.id === id)?.label ?? id;
}
