import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './app/app.css';
import './theme/themes/index.css';
import { App } from './app/App';
import { initTheme } from './theme/theme';

// The theme goes on <html> before anything renders, so the first paint is already in it.
initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
