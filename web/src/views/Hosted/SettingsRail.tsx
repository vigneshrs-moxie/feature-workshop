// The hosted site's Settings: two sections, Laptops and People, in the laptop app's settings layout.
import type { ReactNode } from 'react';

const SECTIONS = [
  { id: 'laptops', label: 'Laptops', hint: 'The laptops paired with your account: online or not, and Remove.' },
  { id: 'people', label: 'People', hint: 'Everyone who has signed in, and their roles.' },
] as const;

export function HostedSettings({ at, children }: { at: 'laptops' | 'people'; children: ReactNode }) {
  return (
    <main className="page page-settings" aria-label="Settings">
      <div className="page-inner settings">
        <header className="page-head"><h2 className="page-title">Settings</h2></header>
        <div className="settings-layout">
          <nav className="settings-rail" aria-label="Settings sections">
            <ul className="settings-rail-list">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a className={`settings-rail-row${s.id === at ? ' is-current' : ''}`} href={`#/settings/${s.id}`} aria-current={s.id === at ? 'page' : undefined} title={s.hint}>
                    <span className="settings-rail-name">{s.label}</span>
                    <span className="settings-rail-value muted">{s.hint}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <section className="settings-body hosted-settings-body" aria-label={SECTIONS.find((s) => s.id === at)?.label}>{children}</section>
        </div>
      </div>
    </main>
  );
}
