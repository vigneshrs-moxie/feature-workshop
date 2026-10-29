import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './app/app.css';
import './app/shell.css';
import './app/pages.css';
import './play/play.css';
import './play/achievements.css';
import './play/extras.css';
import './play/eggs.css';
import './play/trail.css';
import './play/floor.css';
import './home/home.css';
import './job/job.css';
import './theme/themes/index.css';
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
