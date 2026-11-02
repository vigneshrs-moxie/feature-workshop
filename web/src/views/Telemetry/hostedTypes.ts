// What the hosted site's team Telemetry answers (hosted/site/routes-telemetry.js, packet 2E). The
// three common graphs keep the laptop's shapes (api/types.ts: limit, models, people), so the laptop's
// charts draw them; the two private ones are the site's own (usage by day by job, cost per ticket and
// stage).
import type { LimitSplit, TelemetryGraph, TelemetryAudience } from '../../api/types';

/** The newest reading of one meter on the site. current: it is of the window running now. */
export interface TeamMeter { percent: number; resetsAt: string | null; at: string; current: boolean }

/** GET /api/telemetry/team?tz= */
export interface TeamTelemetry {
  from: string;
  to: string;
  timeZone: string;
  /** "Week from Wed 28 Oct, 4 pm" */
  weekLabel: string;
  me: number | null;
  percentPerDollar: number | null;
  limits: { week: LimitSplit; fiveHour: LimitSplit; note: string; otherLabel: string };
  /** limit, models and people: about the whole account, the same for everyone. */
  graphs: TelemetryGraph[];
  meters: { week: TeamMeter | null; fiveHour: TeamMeter | null };
  people: { id: number; name: string; you: boolean }[];
  /** Lines this week, everyone's. */
  lines: number;
  newest: string | null;
}

export interface ByDayData {
  days: { key: string; label: string; usd: number; percent: number | null; parts: { key: string; usd: number }[] }[];
  jobs: { key: string; label: string; slot: number }[];
  ratio: number | null;
}
export interface TicketStageData {
  tickets: { key: string; label: string; usd: number; percent: number | null }[];
  stages: { stage: string | null; label: string; usd: number; share: number; percent: number | null }[];
  ratio: number | null;
}
interface PrivateBase<I extends string, D> {
  id: I;
  n: number;
  title: string;
  audience: TelemetryAudience;
  state: 'ok' | 'not-enough' | 'cannot-see' | 'empty';
  headline: string;
  todo: string;
  sub: string | null;
  data: D;
  table: { caption: string; head: string[]; rows: string[][] };
  notes: string[];
}
export type PrivateGraph = PrivateBase<'by-day', ByDayData> | PrivateBase<'ticket-stage', TicketStageData>;

/** GET /api/telemetry/people/:id?tz= (your own id only). */
export interface MyTelemetry { person: { id: number; name: string }; graphs: PrivateGraph[]; lines: number }
