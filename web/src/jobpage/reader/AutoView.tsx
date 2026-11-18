// What Auto decided in the reader (18 Nov; the old page's drawer, job/WhatAutoDecided.tsx): the button
// beside the header's Auto switch opens it. The list is the shared one (AutoDecidedList): the summary
// lines, every decision newest first, and who started Auto. It is read (GET /api/job/:slug/auto) when
// the view opens; the body stays empty until it lands, and a second visit paints what was read before.
// On the website the list is the website's copy (hosted/site/routes-mirror.js autoLog).

import { AutoDecidedList } from '../../job/WhatAutoDecided';
import { useJob } from '../useJob';
import { ReaderBody } from './ReaderBody';

export function AutoView() {
  const slug = useJob((s) => s.slug);
  return (
    <ReaderBody view="auto" place="auto:auto" className="jp2-autov">
      <div className="auto-decided"><AutoDecidedList slug={slug} quiet /></div>
    </ReaderBody>
  );
}
