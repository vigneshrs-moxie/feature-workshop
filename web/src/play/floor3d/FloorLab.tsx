// The floor lab, #/floor-lab: a page reachable only by its address (never linked or named in the
// app), for checking the 3D floor by eye. Three tabs:
//   Poses           every pose for every role (labFixtures.ts)
//   Live floor      the floor from the dashboard's own jobs, with the states the demo lacks added
//   Twelve benches  twelve benches and thirty figures all at work, with the frame time shown
// and a switch between Light and Default. Like the floor itself it needs Play full; ?play=full in
// the address turns it on for this page without saving anything.
//   #/floor-lab?play=full&lab=poses|live|twelve&theme=light|default
import { useEffect, useMemo, useState } from 'react';
import { usePlay } from '../usePlay';
import { applyTheme, currentTheme } from '../../theme/theme';
import { Floor3D } from './Floor3D';
import { busyBenches, poseBenches } from './labFixtures';
import type { FrameStats } from './types';

type Tab = 'poses' | 'live' | 'twelve';
const TABS: { id: Tab; label: string }[] = [
  { id: 'poses', label: 'Poses' },
  { id: 'live', label: 'Live floor' },
  { id: 'twelve', label: 'Twelve benches' },
];

function tabFromHash(): Tab {
  const q = new URLSearchParams(/\?(.*)$/.exec(window.location.hash)?.[1] ?? '');
  const t = q.get('lab');
  return t === 'live' || t === 'twelve' ? t : 'poses';
}

function hrefFor(tab: Tab): string {
  const q = new URLSearchParams(/\?(.*)$/.exec(window.location.hash)?.[1] ?? '');
  q.set('lab', tab);
  return `#/floor-lab?${q.toString()}`;
}

declare global {
  interface Window { __floorStats?: FrameStats }
}

export function FloorLab({ live }: { live?: () => ReturnType<typeof poseBenches> }) {
  const play = usePlay();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [theme, setTheme] = useState(currentTheme);
  const [stats, setStats] = useState<FrameStats | null>(null);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // The theme switch changes the page only while the lab is open; leaving puts yours back.
  useEffect(() => {
    const before = currentTheme();
    return () => applyTheme(before);
  }, []);
  const pick = (id: string) => { applyTheme(id); setTheme(id); };
  const benches = useMemo(() => (tab === 'poses' ? poseBenches() : tab === 'twelve' ? busyBenches() : live?.() ?? []), [tab, live]);
  const onStats = (s: FrameStats) => { window.__floorStats = s; setStats(s); };

  return (
    <main className="pane floor-lab" data-pane="floor-lab" aria-label="Floor lab">
      <div className="floor-lab-column">
        <h1 className="floor-lab-title">Floor lab</h1>
        <p className="muted floor-lab-lead">For checking the 3D floor by eye. Every bench here is made up except on the live floor.</p>
        {!play.full ? (
          <p className="floor-lab-off">The 3D floor is part of Play full. Turn it on in Settings, under Play, or add <code className="inline-code">?play=full</code> to this page’s address.</p>
        ) : (
          <>
            <div className="floor-lab-bar">
              <nav className="floor-lab-tabs" aria-label="What to show">
                {TABS.map((t) => (
                  <a key={t.id} className={`btn btn-quiet${t.id === tab ? ' is-active' : ''}`} href={hrefFor(t.id)} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>
                ))}
              </nav>
              <div className="floor-lab-themes" role="group" aria-label="Theme">
                {[{ id: 'light', label: 'Light' }, { id: 'default', label: 'Default' }].map((t) => (
                  <button key={t.id} type="button" className="btn btn-quiet" aria-pressed={theme === t.id} onClick={() => pick(t.id)}>{t.label}</button>
                ))}
              </div>
            </div>
            {tab === 'twelve' && (
              <p className="floor-lab-stats muted" data-floor-stats>
                {stats ? `${stats.benches} benches, ${stats.figures} figures · ${stats.avgMs.toFixed(2)} ms a frame on average, ${stats.p95Ms.toFixed(2)} ms at the 95th percentile · ${Math.round(stats.fps)} frames a second` : 'Measuring the frame time…'}
              </p>
            )}
            <Floor3D key={tab} benches={benches} busy={tab === 'twelve'} onStats={tab === 'twelve' ? onStats : undefined} onOpenJob={tab === 'live' ? undefined : () => {}} label={TABS.find((t) => t.id === tab)?.label} />
          </>
        )}
      </div>
    </main>
  );
}

export default FloorLab;
