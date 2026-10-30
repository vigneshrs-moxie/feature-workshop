// The gallery's review rounds (packet R): the review panel's states and the Desk's review card, drawn
// from the invented rounds the tests use (views/Review/test-fixtures.ts: a made-up reviewer "Raj"
// and repository), through a stand-in API that answers only GET /api/review/<slug>. Nothing is
// sent anywhere: a press answers with the same view.
import { useMemo, type ReactNode } from 'react';
import type { ApiClient } from '../../api/client';
import type { Permission, ReviewView } from '../../api/types';
import { WorkshopContext, useWorkshop } from '../../state/store';
import { PermissionAlert } from '../../components/permissions/PermissionAlert';
import { ReviewDeskCard } from '../Review/ReviewDeskCard';
import { ReviewPanel } from '../Review/ReviewPanel';
import { AT, view } from '../Review/test-fixtures';

function newRound(): ReviewView {
  const v = view('asked', {
    slug: 'gallery-new-round',
    rounds: [
      { round: 1, pr: 2, prLabel: 'PR #2', state: 'sent', items: 4, openedAt: AT, sentAt: AT },
      { round: 2, pr: 2, prLabel: 'PR #2', state: 'asked', items: 5, openedAt: AT, sentAt: null },
    ],
  });
  v.pr = { ...v.pr, checks: 'passing' };
  v.round = {
    ...v.round!, round: 2, title: 'Round 2 · PR #2',
    groups: v.round!.groups
      .filter((g) => !g.heading.startsWith('Checks'))
      .map((g, n) => (n === 0 ? { ...g, items: g.items.map((i, k) => (k === 0 ? { ...i, state: 'fixed' as const, stateWords: 'Fixed in 3f9c2e1' } : i)) } : g)),
  };
  return v;
}

const STATES: { name: string; v: () => ReviewView }[] = [
  { name: 'A new round: changes asked for again', v: newRound },
  { name: 'A check failed after the push', v: () => view('check-failed', { slug: 'gallery-check-failed' }) },
  { name: 'Conflicts with the base', v: () => view('conflicts', { slug: 'gallery-conflicts' }) },
  { name: 'Ready to send back', v: () => view('ready', { slug: 'gallery-ready' }) },
];

function Stand({ views, children }: { views: ReviewView[]; children: ReactNode }) {
  const { store } = useWorkshop();
  const api = useMemo(() => {
    const bySlug = new Map(views.map((v) => [v.slug, v]));
    const answer = (path: string) => {
      const slug = decodeURIComponent(/\/api\/review\/([^/]+)/.exec(path)?.[1] ?? '');
      const v = bySlug.get(slug);
      return v ? Promise.resolve(v) : Promise.reject(new Error('Not in the gallery.'));
    };
    return { get: answer, post: answer, del: answer } as unknown as ApiClient;
  }, [views]);
  return <WorkshopContext.Provider value={{ store, api }}>{children}</WorkshopContext.Provider>;
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const PERMISSION = {
  id: 'gallery-permission', slug: 'gallery-job', kind: 'permission', toolName: 'Bash', createdAt: ago(3), agentType: 'feature-tester',
  plain: { headline: 'Run the feedback tests', detail: 'Runs one test file in the job’s own folder.' },
  input: { command: 'npm test -- --run src/feedback/FeedbackForm.test.tsx' },
  decisionReason: 'Commands that run code ask first.',
} as unknown as Permission;
const HARD_LINE = {
  id: 'gallery-hard-line', slug: 'gallery-job', kind: 'permission', toolName: 'Bash', createdAt: ago(12),
  plain: { headline: 'Push the branch to GitHub' },
  input: { command: 'git push origin feature/feedback-api' },
  hardLine: { reason: 'Anything that writes to GitHub asks you first.' },
} as unknown as Permission;

export function GalleryReview() {
  const views = useMemo(() => STATES.map((s) => s.v()), []);
  const ask = views[0];
  const card = {
    id: 'gallery-review-card', slug: ask.slug, roundCard: true, key: 'gallery', disabled: null,
    review: { slug: ask.slug, state: 'asked', round: 2, pr: 2, prLabel: 'PR #2' },
    actions: [{ id: 'fix', label: 'Fix with the Foreman' }, { id: 'leave', label: 'Leave it for now' }],
    plain: { headline: ask.bar?.headline ?? 'Raj asked for changes', detail: ask.bar?.detail ?? null },
    input: { questions: [{ question: 'Round 2' }] },
  } as unknown as Permission;
  return (
    <Stand views={views}>
      <div className="gallery-review">
        {STATES.map((s, n) => (
          <section key={s.name} className="gallery-review-state" aria-label={s.name}>
            <h4 className="gallery-row-name">{s.name}</h4>
            <ReviewPanel slug={views[n].slug} />
          </section>
        ))}
        <section className="gallery-review-state" aria-label="The permission alert">
          <h4 className="gallery-row-name">The permission alert, and a hard line</h4>
          <PermissionAlert permissions={[PERMISSION]} now={new Date()} />
          <PermissionAlert permissions={[HARD_LINE]} now={new Date()} />
        </section>
        <section className="gallery-review-state" aria-label="The Desk’s review card">
          <h4 className="gallery-row-name">The Desk’s review card</h4>
          <div className="desk-one gallery-desk-card"><ReviewDeskCard permission={card} call={false} /></div>
        </section>
      </div>
    </Stand>
  );
}
