import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setCrewClock } from './play/eggs';

// The crew's clock is fixed at an ordinary weekday noon, so no seasonal hat or nightcap turns up
// in a snapshot by chance; a test about them sets its own.
beforeEach(() => setCrewClock(() => new Date(2026, 5, 17, 12)));
afterEach(() => cleanup());
