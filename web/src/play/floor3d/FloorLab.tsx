// The station lab, #/station-lab (the old #/floor-lab still opens it): a page reachable only by its
// address (never linked or named in the app), for checking the 3D station by eye. Four tabs:
//   Bays            every bay kind (construction bay, repair dock) at every phase (labFixtures.ts)
//   Poses           every pose for every role
//   Live station    the station from the dashboard's own jobs, with made-up jobs for the states
//                   the demo lacks (labFixtures.ts labJobs)
//   Twelve bays     twelve bays and thirty figures all at work, with the frame time shown
// and a switch between Starbase, Starbase day, Light and Default. Like the station itself it needs
// Play full; ?play=full in the address turns it on for this page without saving anything.
//   #/station-lab?play=full&lab=bays|poses|live|twelve&theme=starbase|starbase-day|light|default
import { useEffect, useMemo, useState } from 'react';
import { usePlay } from '../usePlay';
import { applyTheme, currentTheme, THEMES } from '../../theme/theme';
import { Floor3D } from './Floor3D';
import { bayBenches, busyBenches, labJobs, poseBenches } from './labFixtures';
import { useFloorBenches } from './useFloorBenches';
import type { FrameStats } from './types';

type Tab = 'bays' | 'poses' | 'live' | 'twelve';
const TABS: { id: Tab; label: string }[] = [
  { id: 'bays', label: 'Bays' },
  { id: 'poses', label: 'Poses' },
  { id: 'live', label: 'Live station' },
  { id: 'twelve', label: 'Twelve bays' },
];
/** The themes the lab switches between: the station's own pair, then Light and Default. */
const LAB_THEMES = ['starbase', 'starbase-day', 'light', 'default'].map((id) => ({ id, label: THEMES.find((t) => t.id === id)?.label ?? id }));

function tabFromHash(): Tab {
  const q = new URLSearchParams(/\?(.*)$/.exec(window.location.hash)?.[1] ?? '');
  const t = q.get('lab');
  return t === 'poses' || t === 'live' || t === 'twelve' ? t : 'bays';
}

function hrefFor(tab: Tab): string {
  const q = new URLSearchParams(/\?(.*)$/.exec(window.location.hash)?.[1] ?? '');
  q.set('lab', tab);
  return `#/station-lab?${q.toString()}`;
}

declare global {
  interface Window { __floorStats?: FrameStats }
}

export function FloorLab() {
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
  // The live floor: the dashboard's own jobs, plus made-up ones for the states they lack.
  const extra = useMemo(() => labJobs(), []);
  const live = useFloorBenches(extra);
  const made = useMemo(() => (tab === 'bays' ? bayBenches() : tab === 'poses' ? poseBenches() : busyBenches()), [tab]);
  const benches = tab === 'live' ? live : made;
  const onStats = (s: FrameStats) => { window.__floorStats = s; setStats(s); };

  return (
    <main className="pane floor-lab" data-pane="floor-lab" aria-label="Station lab">
      <div className="floor-lab-column">
        <h1 className="floor-lab-title">Station lab</h1>
        <p className="muted floor-lab-lead">For checking the 3D station by eye. Every bay here is made up except on the live station.</p>
        {!play.full ? (
          <p className="floor-lab-off">The 3D station is part of Play full. Turn it on in Settings, under Play, or add <code className="inline-code">?play=full</code> to this page’s address.</p>
        ) : (
          <>
            <div className="floor-lab-bar">
              <nav className="floor-lab-tabs" aria-label="What to show">
                {TABS.map((t) => (
                  <a key={t.id} className={`btn btn-quiet${t.id === tab ? ' is-active' : ''}`} href={hrefFor(t.id)} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>
                ))}
              </nav>
              <div className="floor-lab-themes" role="group" aria-label="Theme">
                {LAB_THEMES.map((t) => (
                  <button key={t.id} type="button" className="btn btn-quiet" aria-pressed={theme === t.id} onClick={() => pick(t.id)}>{t.label}</button>
                ))}
              </div>
            </div>
            {tab === 'twelve' && (
              <p className="floor-lab-stats muted" data-floor-stats>
                {stats ? `${stats.benches} bays, ${stats.figures} figures · ${stats.avgMs.toFixed(2)} ms a frame on average, ${stats.p95Ms.toFixed(2)} ms at the 95th percentile · ${Math.round(stats.fps)} frames a second` : 'Measuring the frame time…'}
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
