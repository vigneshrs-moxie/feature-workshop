// Claude usage limits (the 5-hour and weekly ones on a Claude plan).
// When a reply run from the dashboard hits one, every reply still going is paused, the home page
// says so, and once the limit resets each paused job is told to carry on, without anyone asking.
// Terminal sessions aren't ours to pause; the warning tells you about them instead.

import { EventEmitter } from 'node:events';

export const LIMIT_LABELS = {
  five_hour: '5-hour limit', seven_day: 'weekly limit', seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit', seven_day_overage_included: 'weekly Fable limit', overage: 'extra-usage limit',
};
export const RESUME_TEXT = 'Your Claude usage limit has reset, so please carry on with this job from where you stopped. '
  + 'The pause may have cut a step off part-way: check where things stand (files, commits, the job record) before continuing.';

const GRACE_MS = 90_000; // start a little after the reset, not on the dot
const RETRY_MS = 30 * 60_000; // when the reset time is unknown, try again after this long
const STAGGER_MS = 4000; // space out the resumed jobs
const MAX_TIMER = 2 ** 31 - 1;

const label = (kind) => LIMIT_LABELS[kind] ?? 'usage limit';
// The event reports utilisation as a fraction; the usage report as a percentage.
const percent = (u) => (typeof u !== 'number' ? null : Math.round(u <= 1 ? u * 100 : u));

export class LimitWatch extends EventEmitter {
  /** driver: Driver. state: State. timers and clock are injectable for tests. */
  constructor({ driver, state, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    super();
    Object.assign(this, { driver, state, now, setTimer, clearTimer });
    this.limit = null; // { kind, since, resetsAt (ms), resetKnown, jobs: [{ featureDir, slug, title, cwd, sessionId, model }] }
    this.warning = null; // { kind, percent, resetsAt }
    this.autoResume = true;
    this.timer = null;
  }

  async load() {
    const s = await this.state.getSettings();
    this.autoResume = s.autoResume !== false;
    if (s.usageLimit?.jobs) this.limit = s.usageLimit;
    this.#schedule();
  }

  isLimited() { return Boolean(this.limit); }
  pausedJob(featureDir) { return this.limit?.jobs.find((j) => j.featureDir === featureDir) ?? null; }

  view() {
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
    const warning = this.warning && (!this.warning.resetsAt || this.warning.resetsAt > this.now()) ? this.warning : null;
    return {
      limited: Boolean(this.limit),
      label: this.limit ? label(this.limit.kind) : null,
      since: iso(this.limit?.since),
      resetsAt: iso(this.limit?.resetsAt),
      resetKnown: Boolean(this.limit?.resetKnown),
      jobs: (this.limit?.jobs ?? []).map((j) => ({ slug: j.slug, title: j.title })),
      autoResume: this.autoResume,
      warning: warning ? { label: label(warning.kind), percent: warning.percent, resetsAt: iso(warning.resetsAt) } : null,
    };
  }

  /** A run reported the limit. run: the driver's view of it. info: SDKRateLimitInfo or null. */
  async onLimit({ run, info }) {
    const at = this.now();
    const reported = info?.resetsAt ? info.resetsAt * 1000 : null;
    const resetKnown = Boolean(reported && reported > at);
    const resetsAt = resetKnown ? reported : at + RETRY_MS;
    const first = !this.limit;
    if (first) this.limit = { kind: info?.rateLimitType ?? null, since: at, resetsAt, resetKnown, jobs: [] };
    else if (resetKnown && (!this.limit.resetKnown || reported > this.limit.resetsAt)) Object.assign(this.limit, { resetsAt, resetKnown, kind: info?.rateLimitType ?? this.limit.kind });
    this.warning = null;
    if (run) this.#add(run);
    // Pause every other reply still going: they would hit the same wall at their next step.
    for (const r of this.driver.list()) {
      if (!['starting', 'running', 'waiting_permission'].includes(r.status)) continue;
      this.#add(r);
      await this.driver.stop(r.id, { reason: 'usage-limit' });
    }
    await this.#save();
    if (first) await this.state.audit({ action: 'usage-limit', kind: this.limit.kind, resetsAt: new Date(this.limit.resetsAt).toISOString(), resetKnown, jobs: this.limit.jobs.map((j) => j.slug) });
    this.#schedule();
    this.emit('change');
  }

  /** Close to a limit (or back under it). */
  onStatus(info) {
    if (!info) return;
    if (info.status === 'allowed_warning') this.warning = { kind: info.rateLimitType ?? null, percent: percent(info.utilization), resetsAt: info.resetsAt ? info.resetsAt * 1000 : null };
    else if (info.status === 'allowed' && this.warning && (!info.rateLimitType || info.rateLimitType === this.warning.kind)) this.warning = null;
    else return;
    this.emit('change');
  }

  /** Carry on now. how: 'auto' (the timer) or 'you' (a click). */
  async resume(how = 'you') {
    if (!this.limit) return { resumed: [] };
    const { jobs } = this.limit;
    this.limit = null;
    this.clearTimer(this.timer);
    await this.#save();
    await this.state.audit({ action: 'usage-limit-resumed', how, jobs: jobs.map((j) => j.slug) });
    this.emit('change');
    const resumed = [];
    for (const [i, job] of jobs.entries()) {
      if (i) await new Promise((r) => this.setTimer(r, STAGGER_MS));
      if (this.limit) {
        // An earlier one hit the limit again: the rest wait for the next reset with it.
        for (const rest of jobs.slice(i)) if (!this.pausedJob(rest.featureDir)) this.limit.jobs.push(rest);
        await this.#save();
        this.emit('change');
        break;
      }
      try {
        await this.driver.start({ featureDir: job.featureDir, slug: job.slug, title: job.title, cwd: job.cwd, sessionId: job.sessionId, model: job.model, text: RESUME_TEXT, kind: 'resume', additionalDirectories: job.additionalDirectories ?? [] });
        resumed.push(job.slug);
      } catch (err) {
        await this.state.audit({ action: 'usage-limit-skip', featureDir: job.featureDir, slug: job.slug, reason: String(err?.message ?? err) });
      }
    }
    return { resumed };
  }

  async setAutoResume(on) {
    this.autoResume = Boolean(on);
    await this.state.setSettings({ autoResume: this.autoResume });
    this.#schedule();
    this.emit('change');
  }

  /** A job sent a message by hand while paused no longer waits for the automatic carry-on. */
  async forget(featureDir) {
    if (!this.limit) return;
    this.limit.jobs = this.limit.jobs.filter((j) => j.featureDir !== featureDir);
    await this.#save();
    this.emit('change');
  }

  #add(run) {
    if (!run?.featureDir || !run.sessionId || this.limit.jobs.some((j) => j.featureDir === run.featureDir)) return;
    this.limit.jobs.push({ featureDir: run.featureDir, slug: run.slug, title: run.title, cwd: run.cwd, sessionId: run.sessionId, model: run.model, additionalDirectories: run.additionalDirectories ?? [] });
  }

  #schedule() {
    this.clearTimer(this.timer);
    this.timer = null;
    if (!this.limit || !this.autoResume) return;
    const wait = Math.min(MAX_TIMER, Math.max(5000, this.limit.resetsAt + (this.limit.resetKnown ? GRACE_MS : 0) - this.now()));
    this.timer = this.setTimer(() => { this.resume('auto').catch(() => {}); }, wait);
    this.timer?.unref?.();
  }

  async #save() {
    await this.state.setSettings({ usageLimit: this.limit });
  }
}
