// The Desk page (#/desk): the Desk in the layout you picked in Settings → Look (One at a time by
// default, or Three columns), with its three-card guide. In Play full, faint grid lines sit behind
// it: this is the go / no go console. Subtle and Off have none.
import { useMemo } from 'react';
import { Page, type GuideSpec } from '../components/page/Page';
import { useStored } from '../lib/stored';
import { useNow } from '../lib/time';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshopState } from '../state/store';
import { DESK_LAYOUT_KEY, DeskView, type DeskLayout } from './DeskView';
import { deskQueue } from './homeModel';

export const DESK_GUIDE: GuideSpec = {
  id: 'desk',
  title: 'How the Desk works',
  done: 'Show me the first one',
  cards: [
    { icons: ['users', 'help'], title: 'The crew asks', say: 'A go-ahead, a question or a permission, from any job.' },
    { icons: ['list'], title: 'One at a time', say: 'The oldest first. The dots show how many are left.' },
    { icons: ['x', 'check'], title: 'You say go or no go', say: 'One key each: a for go, r for send back, c to reply.' },
  ],
};

export function useDeskLayout(): [DeskLayout, (layout: DeskLayout) => void] {
  const [raw, set] = useStored(DESK_LAYOUT_KEY);
  return [raw === 'columns' ? 'columns' : 'one', (l) => set(l === 'one' ? null : l)];
}

export function DeskPage() {
  const state = useWorkshopState();
  const now = useNow();
  const play = usePlayIfAny();
  const [layout] = useDeskLayout();
  const items = useMemo(() => deskQueue(state.jobs, state.permissions), [state.jobs, state.permissions]);
  return (
    <Page label="Desk" title="Desk" className={`page-desk desk-layout-${layout}${play?.full ? ' has-grid' : ''}`} guide={DESK_GUIDE}>
      <DeskView items={items} now={now} layout={layout} />
    </Page>
  );
}
