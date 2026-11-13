// The phone's reader screen (plan Task 15; design brief "Phone": "Reader screen: one thing, full
// width, with a back row"). JobPage2 shows the reader over the whole page on the phone, with the same
// views as the laptop's reader (the conversation folded the same way) under this back row. Back
// follows history (phone/PhoneJob2.tsx usePhoneMoves): to the step screen or the job screen it was
// opened from, or to the job screen when the reader was opened by a link or a reload. Escape too.

import { memo } from 'react';
import { Button } from '../../components/Button';

export const PhoneReader = memo(function PhoneReader({ onBack }: { onBack(): void }) {
  return (
    <div className="jp2-pback">
      <Button kind="quiet" icon="chevron-left" onClick={onBack} title="Go back to where you opened this.">Back</Button>
    </div>
  );
});
