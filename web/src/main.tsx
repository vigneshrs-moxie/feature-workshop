import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './components/controls.css';
import './components/sheet.css';
import './components/palette.css';
import './app/app.css';
import './app/shell.css';
import './app/pages.css';
import './play/play.css';
import './play/achievements.css';
import './views/CrewDex/crewDex.css';
import './views/Achievements/achievementsView.css';
import './play/extras.css';
import './play/eggs.css';
import './play/trail.css';
import './play/floor.css';
import './home/home.css';
import './home/flow.css';
import './job/job.css';
import './theme/themes/index.css';
// The stylesheets the pages bring with them, here in the order they always had, so the whole app's
// CSS stays one stylesheet in one order (app/cssOrder.test.ts) while each page's code is its own
// chunk (app/pages.tsx): a page's look never waits for its chunk, nor changes with what loaded first.
import './views/Review/review.css';
import './views/Gallery/gallery.css';
import './views/JobSheets/jobSheets.css';
import './job/auto.css';
import './views/Stack/stack.css';
import './views/Stack/stacks-home.css';
import './play/floor3d/floor3d.css';
import './views/Settings/settings.css';
import './theme/look.css';
import './views/Stack/stack-page.css';
import './views/Stack/part-page.css';
import './jobpage/answers.css';
import './jobpage/left/prlines.css';
import './jobpage/asks.css';
import './jobpage/reader/prview.css';
import './jobpage/jobpage.css';
import './views/Telemetry.css';
import './views/Telemetry/hostedTelemetry.css';
import './views/Lounge/lounge.css';
import './views/Hosted/hosted.css';
import './views/Guide/guide.css';
import { App } from './app/App';
import { initTheme } from './theme/theme';
import { initTextSize } from './theme/textSize';

// The theme and the text size go on <html> before anything renders, so the first paint is already
// in them. A hidden theme (CRT Terminal, Gold) is the exception: it waits for the play ledger to say
// it is unlocked (theme/theme.ts), so the default shows for a moment first; nothing in the browser
// can unlock it.
initTheme();
initTextSize();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
