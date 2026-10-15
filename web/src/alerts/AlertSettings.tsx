// The two alert switches at the foot of the Jobs pane: browser notifications and the chime.
import { useState } from 'react';
import { useStored } from '../lib/stored';
import { alertOutputs, askNotifyPermission, CHIME_KEY, notifySupport, NOTIFY_KEY } from './alerts';

const BLOCKED = 'Your browser blocks notifications from this page. You can allow them in the browser’s site settings.';

export function AlertSettings() {
  const [notify, setNotify] = useStored(NOTIFY_KEY);
  const [chime, setChime] = useStored(CHIME_KEY);
  const [note, setNote] = useState<string | null>(null);
  const support = notifySupport();
  const notifyOn = notify === 'on' && support === 'granted';
  const chimeOn = chime === 'on';

  async function toggleNotify() {
    setNote(null);
    if (notifyOn) { setNotify('off'); return; }
    const answer = await askNotifyPermission();
    if (answer === 'granted') { setNotify('on'); return; }
    setNotify('off');
    if (answer === 'denied') setNote(BLOCKED);
  }

  function toggleChime() {
    if (chimeOn) { setChime('off'); return; }
    setChime('on');
    alertOutputs.chime(); // so you hear what it sounds like
  }

  const notifyHint = support === 'unsupported'
    ? 'This browser can’t show notifications.'
    : notifyOn
      ? 'Notifications are on: when a job needs you while you’re in another tab or window, your computer shows a notification. Click to turn them off.'
      : support === 'denied'
        ? BLOCKED
        : 'Turn on notifications: when a job needs you while you’re in another tab or window, your computer shows one. Your browser asks once for permission.';

  return (
    <div className="alert-settings" data-alerts-control>
      <span className="alert-settings-title">Alerts</span>
      <button
        type="button"
        className="btn btn-quiet btn-toggle"
        aria-pressed={notifyOn}
        disabled={support === 'unsupported'}
        onClick={() => void toggleNotify()}
        title={notifyHint}
      >
        Notifications <span className="toggle-state">{notifyOn ? 'On' : 'Off'}</span>
      </button>
      <button
        type="button"
        className="btn btn-quiet btn-toggle"
        aria-pressed={chimeOn}
        onClick={toggleChime}
        title={chimeOn ? 'The chime is on: a short, soft sound plays when a job newly needs you. Click to turn it off.' : 'Turn on a short, soft chime that plays when a job newly needs you. You’ll hear it once now.'}
      >
        Chime <span className="toggle-state">{chimeOn ? 'On' : 'Off'}</span>
      </button>
      {note && <p className="alert-settings-note" role="status">{note}</p>}
    </div>
  );
}
