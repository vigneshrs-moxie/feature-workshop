// The product's mark: the radar on the accent square. The top bar on the laptop and on the site, and
// the site's sign-in card, all draw it from here; web/public/favicon.svg is the same picture in the
// Light theme's colours, for the browser tab.
import { Icon } from '../components/Icon';

export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return <span className={size === 'lg' ? 'gc-mark gc-mark-lg' : 'gc-mark'} aria-hidden="true"><Icon name="radar" size={size === 'lg' ? 30 : 16} /></span>;
}
