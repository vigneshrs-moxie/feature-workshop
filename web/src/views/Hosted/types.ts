// What the hosted site's routes answer (hosted/site/routes-*.js, packet 2A).

export type Role = 'owner' | 'manager' | 'member';

export interface HostedPerson { id: number; name: string; email: string; role: Role }

/** GET /api/meta on the hosted site. */
export interface HostedMeta {
  mode: 'hosted';
  product?: string;
  person: HostedPerson | null;
  signIn: string;
  /** The pretend Google sign-in (a laptop's trial, never on Vercel). */
  fakeSignIn?: boolean;
  /** The settings this deployment lacks, by name. */
  missing?: string[];
  /** A deployment without the database (a preview: the database is connected to Production only). */
  noDatabase?: boolean;
}

/** A paired laptop (GET /api/laptops). online: seen in the last 60 seconds. */
export interface Laptop { id: number; name: string; os: string; version: string | null; pairedAt: string; lastSeenAt: string | null; online: boolean }

/** One job as the site mirrors it (GET /api/jobs). */
export interface MirroredJob {
  id: number; laptopId: number; slug: string; title: string; ticket: string | null; stage: string | null;
  state: string | null; stateWords: string | null; now: string | null; updatedAt: string | null;
}

export interface LaptopJobs extends Laptop { jobs: MirroredJob[] }

/** GET /api/pair/:code. */
export interface Pairing { code: string; name: string; os: string; state: 'waiting' | 'approved' | 'paired' | 'expired'; expiresAt: string }

/** GET /api/people. */
export interface PersonRow extends HostedPerson { lastSignInAt: string | null; you: boolean }
