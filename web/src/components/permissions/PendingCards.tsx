// The permission and question cards waiting for you: one job's (at the foot of its thread) or
// every job's (the Needs-you list when no job is open), oldest first.
import type { Permission } from '../../api/types';
import { jobHref } from '../../app/router';
import { useWorkshopState } from '../../state/store';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';

const byAge = (a: Permission, b: Permission) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

export function Card({ p, now, showJob }: { p: Permission; now: Date; showJob?: boolean }) {
  return p.kind === 'question'
    ? <QuestionCard permission={p} now={now} showJob={showJob} />
    : <PermissionCard permission={p} now={now} showJob={showJob} />;
}

/** One job's waiting cards. */
export function JobCards({ slug, now }: { slug: string; now: Date }) {
  const { permissions } = useWorkshopState();
  const mine = permissions.filter((p) => p.slug === slug).sort(byAge);
  if (!mine.length) return null;
  return (
    <section className="pending-cards" aria-label="Waiting for you">
      {mine.map((p) => <Card key={p.id} p={p} now={now} />)}
    </section>
  );
}

/** Every job's waiting cards, grouped by job. */
export function NeedsYouCards({ now }: { now: Date }) {
  const { permissions, jobs } = useWorkshopState();
  if (!permissions.length) return <p className="muted">No permission or question is waiting for you.</p>;
  const order: string[] = [];
  const bySlug = new Map<string, Permission[]>();
  for (const p of [...permissions].sort(byAge)) {
    if (!bySlug.has(p.slug)) { bySlug.set(p.slug, []); order.push(p.slug); }
    bySlug.get(p.slug)!.push(p);
  }
  return (
    <div className="needs-you-cards">
      {order.map((slug) => {
        const title = jobs.find((j) => j.slug === slug)?.title || bySlug.get(slug)![0].title || slug;
        return (
          <section key={slug} className="pending-cards" aria-label={`Waiting in ${title}`}>
            <h3 className="pending-job"><a href={jobHref(slug)} title="Open this job’s conversation.">{title}</a></h3>
            {bySlug.get(slug)!.map((p) => <Card key={p.id} p={p} now={now} />)}
          </section>
        );
      })}
    </div>
  );
}
