// A job page's evidence, asked ONCE for the bar's gate card, the Test step and its strip, with the
// two things the page owns about a recording: whether its live picture is on (Watch) and whether
// Try it is open. One place for the laptop page and the phone's screens.

import { useEffect, useRef, useState } from 'react';
import type { EvidenceView, Job } from '../../api/types';
import { useEvidence } from './useEvidence';

export interface JobEvidence {
  view: EvidenceView | null;
  reload(): void;
  recording: boolean;
  watching: boolean;
  setWatching(on: boolean): void;
  tryOpen: boolean;
  setTryOpen(open: boolean): void;
}

export function useJobEvidence(job: Job): JobEvidence {
  const evidence = useEvidence(job.slug);
  const reload = evidence.reload;
  const recording = evidence.view?.recording === true;
  const [watching, setWatching] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);
  // A run that ended is not watched any more: the next one starts unwatched.
  useEffect(() => { if (!recording) setWatching(false); }, [recording]);
  // A recording starts (the job says so first): ask at once, not at the next quiet ask 30 s on.
  const testing = typeof job.testing === 'string' && job.testing.trim() !== '';
  const wasTesting = useRef(testing);
  useEffect(() => {
    if (testing && !wasTesting.current) reload();
    wasTesting.current = testing;
  }, [testing, reload]);
  return { view: evidence.view, reload, recording, watching, setWatching, tryOpen, setTryOpen };
}
