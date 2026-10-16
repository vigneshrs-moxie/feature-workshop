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
const CHECK_MS = 60_000; // the clock is checked every minute: one long timer would oversleep when the Mac sleeps
const BUSY_TRIES = 5;
const MANUAL_SEND = 'You sent a message yourself.';
const LIMITED_AGAIN = 'limited-again';

const label = (kind) => LIMIT_LABELS[kind] ?? 'usage limit';
// The event reports utilisation as a fraction; the usage report as a percentage.
const percent = (u) => (typeof u !== 'number' ? null : Math.round(u <= 1 ? u * 100 : u));
const jobOf = (run) => ({ featureDir: run.featureDir, slug: run.slug, title: run.title, cwd: run.cwd, sessionId: run.sessionId, model: run.model, additionalDirectories: run.additionalDirectories ?? [] });

export class LimitWatch extends EventEmitter {
  /**
   * driver: Driver. state: State. canResume(job): false when the job shouldn't be carried on from
   * here any more (for example it's been picked up in a terminal). Timers and clock are injectable.
   */
  constructor({ driver, state, canResume = async () => true, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval }) {
    super();
    Object.assign(this, { driver, state, canResume, now, setTimer, clearTimer, setTick, clearTick });
    this.limit = null; // { kind, since, resetsAt (ms), resetKnown, jobs: [job] }
    this.queue = []; // jobs being carried on right now, saved so a restart doesn't lose them
    this.warning = null; // { kind, percent, resetsAt }
    this.autoResume = true;
    this.tick = null;
    this.resuming = null;
  }

  async load() {
    const s = await this.state.getSettings();
    this.autoResume = s.autoResume !== false;
    if (s.usageLimit?.jobs) this.limit = s.usageLimit;
    this.queue = Array.isArray(s.usageResumeQueue) ? s.usageResumeQueue : [];
    this.#watch();
    if (!this.limit && this.queue.length) this.#drain('auto').catch(() => {});
  }

  /** Sends wait while a limit is in force: until it resets, or for good while you carry on by hand. */
  isLimited() {
    if (!this.limit) return false;
    return this.autoResume || this.now() < this.#dueAt();
  }
  pausedJob(featureDir) { return this.limit?.jobs.find((j) => j.featureDir === featureDir) ?? null; }

  view() {
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
    const warning = this.warning && (!this.warning.resetsAt || this.warning.resetsAt > this.now()) ? this.warning : null;
    return {
      limited: Boolean(this.limit),
      blocking: this.isLimited(),
      label: this.limit ? label(this.limit.kind) : null,
      since: iso(this.limit?.since),
      resetsAt: iso(this.limit?.resetsAt),
      resetKnown: Boolean(this.limit?.resetKnown),
      passed: Boolean(this.limit) && this.now() >= this.limit.resetsAt,
      // held: a reply you composed waits to be sent then (hold), rather than "carry on".
      jobs: (this.limit?.jobs ?? []).map((j) => ({ slug: j.slug, title: j.title, ...(j.send ? { held: true } : {}) })),
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
    // Jobs still waiting to be carried on from the last limit wait for this one too.
    for (const job of this.queue.splice(0)) this.#add(job);
    // Pause every other reply still going: they would hit the same wall at their next step.
    for (const r of this.driver.list()) {
      if (!['starting', 'running', 'waiting_permission'].includes(r.status)) continue;
      this.#add(r);
      await this.driver.stop(r.id, { reason: 'usage-limit' });
    }
    await this.#save();
    if (first) await this.state.audit({ action: 'usage-limit', kind: this.limit.kind, resetsAt: new Date(this.limit.resetsAt).toISOString(), resetKnown, jobs: this.limit.jobs.map((j) => j.slug) });
    this.#watch();
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

  /** Carry on now. how: 'auto' (the clock) or 'you' (a click). Resolves with the slugs started. */
  async resume(how = 'you') {
    if (!this.limit) return { resumed: [] };
    this.queue.push(...this.limit.jobs.filter((j) => !this.queue.some((q) => q.featureDir === j.featureDir)));
    const jobs = this.limit.jobs.map((j) => j.slug);
    this.limit = null;
    this.#watch();
    await this.#save();
    await this.state.audit({ action: 'usage-limit-resumed', how, jobs });
    this.emit('change');
    return this.#drain(how);
  }

  async setAutoResume(on) {
    this.autoResume = Boolean(on);
    await this.state.setSettings({ autoResume: this.autoResume });
    this.#watch();
    this.emit('change');
  }

  /**
   * "Approve, start after reset": hold a reply for a job until the limit resets, then send it in
   * place of the usual carry-on message (Carry on now sends it too). One held reply per job; a
   * newer one replaces it, and a message you send by hand meanwhile drops it (forget). Kept with
   * the paused jobs, so a restart doesn't lose it.
   * job: { featureDir, slug, title, cwd, sessionId, model, additionalDirectories }.
   * send: { text (exactly what goes to the Foreman), kind, gateBrief }.
   */
  async hold(job, send) {
    if (!this.limit) throw new Error('No usage limit is in force, so there is nothing to wait for.');
    const entry = { ...jobOf(job), send: { text: String(send.text), kind: send.kind ?? 'message', gateBrief: Number.isInteger(send.gateBrief) ? send.gateBrief : null, at: new Date(this.now()).toISOString() } };
    this.limit.jobs = [...this.limit.jobs.filter((j) => j.featureDir !== job.featureDir), entry];
    this.queue = this.queue.filter((j) => j.featureDir !== job.featureDir);
    await this.#save();
    this.emit('change');
    return { resetsAt: new Date(this.limit.resetsAt).toISOString(), resetKnown: Boolean(this.limit.resetKnown), autoResume: this.autoResume };
  }

  /** The reply held for this job until the limit resets ({ kind, gateBrief, at }), or null. */
  heldFor(featureDir) {
    const j = [...(this.limit?.jobs ?? []), ...this.queue].find((x) => x.featureDir === featureDir && x.send);
    return j ? { kind: j.send.kind, gateBrief: j.send.gateBrief, at: j.send.at } : null;
  }

  /**
   * A job sent a message by hand while paused no longer waits for the automatic carry-on. A reply
   * held for it (hold) is dropped too, and the audit says so ('send-held-dropped').
   */
  async forget(featureDir) {
    const removed = [...(this.limit?.jobs ?? []), ...this.queue].filter((j) => j.featureDir === featureDir);
    if (!removed.length) return;
    if (this.limit) this.limit.jobs = this.limit.jobs.filter((j) => j.featureDir !== featureDir);
    this.queue = this.queue.filter((j) => j.featureDir !== featureDir);
    await this.#save();
    const held = removed.find((j) => j.send);
    if (held) await this.state.audit({ action: 'send-held-dropped', featureDir, slug: held.slug, kind: held.send.kind, ...(Number.isInteger(held.send.gateBrief) ? { gateBrief: held.send.gateBrief } : {}), reason: 'manual-send' });
    this.emit('change');
  }

  // Start the queued jobs one by one; each leaves the queue only once it has started (or can't).
  #drain(how) {
    if (this.resuming) return this.resuming;
    this.resuming = (async () => {
      const resumed = [];
      let first = true;
      while (this.queue.length && !this.limit) {
        if (!first) await new Promise((r) => this.setTimer(r, STAGGER_MS));
        first = false;
        if (this.limit) break; // an earlier one hit the limit again: the rest wait with it (onLimit took them)
        const job = this.queue[0];
        let outcome = null;
        if (!(await this.canResume(job))) outcome = 'It’s been picked up somewhere else since the pause.';
        for (let tries = 0; !outcome && tries < BUSY_TRIES; tries++) {
          // Gone from the queue while we waited: the limit hit again (it waits with the limit now),
          // or you sent a message yourself (forget), so a held reply must not go after yours.
          if (!this.queue.includes(job)) { outcome = this.limit ? LIMITED_AGAIN : MANUAL_SEND; break; }
          try {
            // A held reply (hold) goes in place of the carry-on message, as you composed it.
            const send = job.send ? { text: job.send.text, kind: job.send.kind, gateBrief: job.send.gateBrief } : { text: RESUME_TEXT, kind: 'resume' };
            await this.driver.start({ featureDir: job.featureDir, slug: job.slug, title: job.title, cwd: job.cwd, sessionId: job.sessionId, model: job.model, additionalDirectories: job.additionalDirectories, ...send });
            outcome = 'started';
          } catch (err) {
            if (err?.name !== 'Busy' && err?.constructor?.name !== 'Busy') { outcome = String(err?.message ?? err); break; }
            await new Promise((r) => this.setTimer(r, STAGGER_MS)); // its last reply is still finishing
          }
        }
        if (this.queue[0] === job) this.queue.shift();
        if (outcome === 'started') resumed.push(job.slug);
        else if (outcome === LIMITED_AGAIN) { /* it waits with the new limit (onLimit took it) */ }
        // After a message you sent yourself, forget has already noted a held reply as dropped.
        else await this.state.audit({ action: 'usage-limit-skip', featureDir: job.featureDir, slug: job.slug, how, reason: outcome ?? 'Still busy after several tries.', ...(job.send && outcome !== MANUAL_SEND ? { held: { kind: job.send.kind, gateBrief: job.send.gateBrief, text: job.send.text } } : {}) });
        await this.#save();
        this.emit('change');
      }
      return { resumed };
    })().finally(() => { this.resuming = null; });
    return this.resuming;
  }

  // A paused run, or a job that was waiting to be carried on. A held reply (send) stays with it,
  // and a job with a held reply but no Foreman session yet waits too (the reply starts one).
  #add(run) {
    if (!run?.featureDir || (!run.sessionId && !run.send) || this.limit.jobs.some((j) => j.featureDir === run.featureDir)) return;
    this.limit.jobs.push({ ...jobOf(run), ...(run.send ? { send: run.send } : {}) });
  }

  #dueAt() { return this.limit.resetsAt + (this.limit.resetKnown ? GRACE_MS : 0); }

  // Check the wall clock every minute while a limit waits, rather than trusting one long timer.
  #watch() {
    this.clearTick(this.tick);
    this.tick = null;
    if (!this.limit || !this.autoResume) return;
    this.tick = this.setTick(() => {
      if (this.limit && this.autoResume && this.now() >= this.#dueAt()) this.resume('auto').catch(() => {});
    }, CHECK_MS);
    this.tick?.unref?.();
  }

  async #save() {
    await this.state.setSettings({ usageLimit: this.limit, usageResumeQueue: this.queue });
  }
}
