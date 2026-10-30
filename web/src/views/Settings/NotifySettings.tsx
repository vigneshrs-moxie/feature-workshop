// Settings → Notifications: what the dashboard tells macOS (dashboard/lib/notify.js), so it reaches
// you with this tab closed or the browser hidden. Saved on the dashboard (POST /api/settings
// { notify }); the history (GET /api/notifications) refetches when a new one arrives (the
// 'notification' event). A notification only opens the page: it never approves or sends anything.
// "In this browser" (alerts/AlertSettings.tsx) is this browser's own notification and chime, kept here.
// Usage warnings (80 %, 90 % and full, dashboard/lib/usage-warnings.js) have one switch of their own.
// Send a test and the history come last. Simple first (packet R): sending to macOS and the three
// kinds show; the rest waits in one More that names it. Each change says "Saved" beside its control.
import { useEffect, useState } from 'react';
import { AlertSettings } from '../../alerts/AlertSettings';
import type { NotificationsView, NotifyLevel, NotifyMode, NotifySettings as Notify, Settings } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { Choice, Segmented } from '../../components/Choice';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { Saved, useSaved } from '../../components/Saved';
import { SettingsMore } from './SettingsMore';

/** The times quiet hours can start or end: every half hour, plus the one saved if it is between. */
function timeOptions(current: string): { value: string; label: string }[] {
  const all = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  if (/^\d\d:\d\d$/.test(current) && !all.includes(current)) all.push(current);
  return all.sort().map((t) => ({ value: t, label: t }));
}

/** The settings with the usage warnings' switch (on unless turned off): NotifySettings in api/types.ts. */
type NotifyAll = Notify;

export const NOTIFY_DEFAULTS: Notify = {
  enabled: true,
  levels: { needs: 'sound', problem: 'sound', done: 'silent' },
  quiet: { on: false, from: '22:00', to: '07:00' },
  skipWhenWatching: true,
};

export const LEVELS: { id: NotifyLevel; label: string; hint: string }[] = [
  { id: 'needs', label: 'Needs you', hint: 'A go-ahead, a question or a permission is waiting; also a decision left 4 hours.' },
  { id: 'problem', label: 'Problems', hint: 'A reply ended with an error, or Claude’s usage limit paused the work.' },
  { id: 'done', label: 'Done', hint: 'Reached the finish line you set, or you marked it done. Landing in staging or main after that is told without a sound.' },
];
const MODES: { id: NotifyMode; label: string }[] = [
  { id: 'sound', label: 'With a sound' },
  { id: 'silent', label: 'Silent' },
  { id: 'off', label: 'Off' },
];
const METHOD: Record<string, string> = {
  'terminal-notifier': 'Sent with terminal-notifier: clicking one opens that job here.',
  osascript: 'Sent with macOS’s built-in notifier: clicking one can’t open the job. Install terminal-notifier (brew install terminal-notifier) and restart the dashboard for that.',
};

export function NotifySettings() {
  const { api, store } = useWorkshop();
  const { meta, notificationsVersion } = useWorkshopState();
  const now = useNow();
  const n: NotifyAll = { ...NOTIFY_DEFAULTS, ...(meta?.settings?.notify as NotifyAll | undefined) };
  const [view, setView] = useState<NotificationsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const saved = useSaved();

  useEffect(() => {
    let live = true;
    api.get<NotificationsView>('/api/notifications').then((v) => { if (live && Array.isArray(v?.history)) setView(v); }).catch(() => {});
    return () => { live = false; };
  }, [api, notificationsVersion]);

  async function save(patch: Partial<NotifyAll>, what: string) {
    setBusy(true);
    setError(null);
    try { store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', { notify: patch }) }); saved.mark(what); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function test() {
    setTested(null);
    try {
      const e = await api.post<{ sent: boolean; why?: string }>('/api/notifications/test', {});
      setTested(e.sent ? `Sent: look at the top right of your screen.${e.why ? ` ${e.why}` : ''}` : `Not sent: ${e.why ?? 'The computer didn’t show it.'}`);
      setView(await api.get<NotificationsView>('/api/notifications'));
    } catch (err) { setTested(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <section aria-label="Notifications" className="notify-settings" aria-busy={busy}>
      <h3 className="settings-heading" title="Notifications from the dashboard itself, so they reach you when this tab is closed or the browser is hidden.">Notifications</h3>
      <HowThisWorks id="notify-settings">
        <p>The dashboard tells macOS when something needs you, goes wrong or gets done, so you hear about it in any app, even with this tab closed. While you’re looking at the dashboard nothing pops (the page shows it already). A notification only opens the page: deciding stays here.</p>
        <p>Each kind can come with a sound, silently, or not at all. In quiet hours only problems show, without a sound; everything still goes into the history below.</p>
      </HowThisWorks>
      <p className="muted">{view ? (view.method ? METHOD[view.method] : 'This computer can’t show them: the dashboard needs macOS.') : 'Checking how notifications reach macOS…'}</p>
      {view?.blocked && (
        <p className="perm-warn" role="status">
          macOS hasn’t allowed terminal-notifier yet, so notifications go through the built-in notifier for now (a click can’t open the job). Turn it on once: <strong>System Settings → Notifications → terminal-notifier → Allow notifications</strong>, then Send a test.
        </p>
      )}
      <div className="setting-row" data-setting="notify-enabled">
        <label className="drawer-check" title="All notifications from the dashboard, on or off.">
          <Choice type="checkbox" checked={n.enabled} onChange={(e) => void save({ enabled: e.target.checked }, 'enabled')} />
          <span>Send notifications to macOS</span>
        </label>
        <Saved tick={saved.tick('enabled')} />
      </div>
      <table className="notify-levels" data-setting="notify-levels">
        <caption className="sr-only">How each kind of notification reaches you</caption>
        <tbody>
          {LEVELS.map((l) => (
            <tr key={l.id}>
              <th scope="row" title={l.hint}>{l.label}<span className="muted notify-level-hint">{l.hint}</span></th>
              <td>
                <div className="setting-row">
                  <Segmented<NotifyMode>
                    label={`${l.label}: how it reaches you`}
                    value={n.levels[l.id]}
                    disabled={!n.enabled}
                    onChange={(m) => { if (m !== n.levels[l.id]) void save({ levels: { ...n.levels, [l.id]: m } }, `level-${l.id}`); }}
                    options={MODES.map((m) => ({ value: m.id, label: m.label, title: `${l.label}: ${m.label.toLowerCase()}.` }))}
                  />
                  <Saved tick={saved.tick(`level-${l.id}`)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SettingsMore id="notify-more" label="More: quiet hours, usage warnings, this browser, a test and the history" holds={['notify-usage', 'notify-quiet', 'notify-watching', 'alerts-browser', 'notify-test', 'notify-history']}>
        <div className="setting-row" data-setting="notify-usage">
          <label className="drawer-check" title="A notification when Claude’s 5-hour or weekly usage reaches 80 %, 90 % and full, once each until it resets. It only tells you: nothing is stopped.">
            <Choice type="checkbox" checked={n.usageWarnings !== false} disabled={!n.enabled} onChange={(e) => void save({ usageWarnings: e.target.checked }, 'usage')} />
            <span>Usage warnings at 80 %, 90 % and full</span>
          </label>
          <Saved tick={saved.tick('usage')} />
        </div>
        <div className="notify-quiet" data-setting="notify-quiet">
          <label className="drawer-check" title="Quiet hours: only problems show, without a sound.">
            <Choice type="checkbox" checked={n.quiet.on} disabled={!n.enabled} onChange={(e) => void save({ quiet: { ...n.quiet, on: e.target.checked } }, 'quiet')} />
            <span>Quiet hours from</span>
          </label>
          <Select className="notify-time" aria-label="Quiet hours start" value={n.quiet.from} options={timeOptions(n.quiet.from)} disabled={!n.enabled} onChange={(v) => void save({ quiet: { ...n.quiet, from: v } }, 'quiet')} title="When quiet hours start." />
          <span>to</span>
          <Select className="notify-time" aria-label="Quiet hours end" value={n.quiet.to} options={timeOptions(n.quiet.to)} disabled={!n.enabled} onChange={(v) => void save({ quiet: { ...n.quiet, to: v } }, 'quiet')} title="When quiet hours end." />
          <Saved tick={saved.tick('quiet')} />
        </div>
        <div className="setting-row" data-setting="notify-watching">
          <label className="drawer-check" title="Nothing pops while this page is in front of you: it already shows what changed.">
            <Choice type="checkbox" checked={n.skipWhenWatching} disabled={!n.enabled} onChange={(e) => void save({ skipWhenWatching: e.target.checked }, 'watching')} />
            <span>Not while I’m looking at the dashboard</span>
          </label>
          <Saved tick={saved.tick('watching')} />
        </div>
        <AlertSettings />
        <div className="perm-actions" data-setting="notify-test">
          <Button onClick={() => void test()} title="Send a test notification to macOS now, even while you’re looking at this page.">Send a test</Button>
          {tested && <span className="muted" role="status">{tested}</span>}
        </div>
        <section className="notify-history" data-setting="notify-history" aria-labelledby="notify-history-title">
          <h4 className="settings-subheading" id="notify-history-title" title="The last 50 notifications, sent or not, newest first.">History ({view?.history.length ?? 0})</h4>
          {view?.history.length ? (
            <ol className="notify-history-list">
              {view.history.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="muted" title={fullTime(h.at)}>{relativeTime(h.at, now)}</span>{' '}
                  <b>{h.title}</b> · {h.body}{' '}
                  <span className="muted">{h.sent ? '· sent' : `· not sent${h.why ? `: ${h.why}` : ''}`}</span>
                </li>
              ))}
            </ol>
          ) : <p className="muted">Nothing yet.</p>}
        </section>
      </SettingsMore>
      {error && <p className="perm-warn" role="alert">{error}</p>}
    </section>
  );
}
