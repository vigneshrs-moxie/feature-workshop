// The switch between the old job page and the new one (plan "Architecture" → Web → The switch):
// `sb.jobPage` in this browser's storage, 'new' or absent. App.tsx and the website's
// HostedWorkshop.tsx mount the new page (JobPage2) when it is 'new'; the old page's job menu has
// "Try the new job page" and the new page's ⋯ menu "Back to the old job page". Flipping it shows the
// other page at once, at the same address, in every open tab (lib/stored.ts).

import { useStored, writeStored } from '../lib/stored';

export const JOB_PAGE_KEY = 'sb.jobPage';

/** True while the new job page is switched on. */
export function useNewJobPage(): boolean {
  const [value] = useStored(JOB_PAGE_KEY);
  return value === 'new';
}

export const tryNewJobPage = () => writeStored(JOB_PAGE_KEY, 'new');
export const backToOldJobPage = () => writeStored(JOB_PAGE_KEY, null);
