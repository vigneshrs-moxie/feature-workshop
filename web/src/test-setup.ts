import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setCrewClock } from './play/eggs';
import { setGuideFirstVisit } from './components/page/Page';
import { setDefaultDetail } from './app/detail';

// The crew's clock is fixed at an ordinary weekday noon, so no seasonal hat or nightcap turns up
// in a snapshot by chance; a test about them sets its own.
beforeEach(() => setCrewClock(() => new Date(2026, 5, 17, 12)));
// A page's first-visit guide stays shut unless a test asks for it (it would hold the page's keys).
beforeEach(() => setGuideFirstVisit(false));
// Every detail shows (Settings → Look → Detail: Full) unless a test asks for Simple, the default.
beforeEach(() => setDefaultDetail('full'));
afterEach(() => cleanup());
