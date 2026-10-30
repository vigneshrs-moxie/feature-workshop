// The component gallery (#/gallery, packet R): every shared control and piece in every state, at
// two text sizes, in the theme that is on. It is for checking the look at 2× zoom (alignment, the
// 4 px grid, optical centring) and each state: hover, pressed, focus, disabled, busy, empty, error.
// Reached only by typing the address: nothing in the app links to it or names it.
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Chip, type ChipTone } from '../../components/Chip';
import { Choice, OptionRow, Segmented } from '../../components/Choice';
import { Field, NumberInput, TextArea, TextInput } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { HiddenSlot, More } from '../../components/More';
import { Hero, NextBar } from '../../components/page/Page';
import { Select } from '../../components/Select';
import { Sheet } from '../../components/Sheet';
import { useTheme } from '../../theme/theme';
import { GalleryReview } from './GalleryReview';
import { Swatches } from './Swatches';
import './gallery.css';

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="gallery-row">
      <span className="gallery-row-name">{name}</span>
      <div className="gallery-row-items">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery-group" aria-label={title}>
      <h3 className="gallery-group-title">{title}</h3>
      <div className="gallery-group-body">{children}</div>
    </section>
  );
}

const MODELS = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'haiku', label: 'Haiku 5', disabled: true },
];
const TONES: ChipTone[] = ['neutral', 'accent', 'info', 'ok', 'warn', 'error', 'needs-you', 'review', 'outline'];
const TONE_WORDS: Record<ChipTone, string> = { neutral: 'Paused', accent: 'L2', info: 'Working', ok: 'Ready', warn: 'Held', error: 'Failed', 'needs-you': 'Go-ahead', review: 'In review', outline: 'Draft' };
const LONG = 'Customer merge across every repository, with the migration first and the tester after it, which is a very long title that has to wrap or truncate without breaking the row';

function Column({ compact }: { compact: boolean }) {
  const [model, setModel] = useState('opus');
  const [detail, setDetail] = useState<'simple' | 'full'>('simple');
  const [size, setSize] = useState('m');
  const [n, setN] = useState('3');
  const [pick, setPick] = useState('a');
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState(false);
  const k = compact ? 'small' : 'medium';
  return (
    <div className={`gallery-col${compact ? ' is-compact' : ''}`}>
      <h2 className="gallery-col-title">{compact ? 'Small text' : 'Medium text'}</h2>

      {!compact && <Group title="Colour tokens and their contrast"><Swatches /></Group>}

      <Group title="Buttons">
        {(['primary', 'secondary', 'quiet', 'danger'] as const).map((kind) => (
          <Row key={kind} name={kind}>
            <Button kind={kind}>Default</Button>
            <Button kind={kind} className="is-hover">Hover</Button>
            <Button kind={kind} className="is-pressed">Pressed</Button>
            <Button kind={kind} className="is-focus">Focus</Button>
            <Button kind={kind} disabled>Disabled</Button>
            <Button kind={kind} busy>Busy</Button>
          </Row>
        ))}
        <Row name="sizes">
          <Button size="sm" icon="plus">Small</Button>
          <Button icon="plus">Default</Button>
          <Button size="lg" kind="primary" icon="check">Large</Button>
          <Button size="sm" iconOnly icon="settings" aria-label="Settings" title="Settings" />
          <Button iconOnly icon="settings" aria-label="Settings" title="Settings" />
          <Button size="lg" iconOnly icon="settings" aria-label="Settings" title="Settings" />
        </Row>
        <Row name="with key">
          <Button kind="primary" size="lg" keyShown keyId="gate-approve">Go: approve and start Test</Button>
          <Button size="lg" keyId="gate-revise" title="Send it back (key: r).">No go: send back</Button>
          <Button href="#/gallery" kind="quiet" icon="terminal">A link that does something</Button>
        </Row>
        <Row name="pressed pair">
          <span className="btn-group"><Button aria-pressed>Page</Button><Button aria-pressed={false}>Source</Button></span>
          <Segmented<'simple' | 'full'> label={`Detail ${k}`} value={detail} onChange={setDetail} options={[{ value: 'simple' as const, label: 'Simple' }, { value: 'full' as const, label: 'Full' }]} />
          <Segmented label={`Text size ${k}`} value={size} onChange={setSize} options={['s', 'm', 'l', 'xl'].map((v) => ({ value: v, label: v.toUpperCase() }))} />
        </Row>
        <Row name="long words">
          <span className="gallery-narrow"><Button>{LONG}</Button></span>
        </Row>
      </Group>

      <Group title="Fields">
        <Row name="text">
          <TextInput placeholder="Your own answer" aria-label={`Empty ${k}`} />
          <TextInput defaultValue="feature/customer-notes" aria-label={`Filled ${k}`} />
          <TextInput defaultValue="Focused" className="is-focus" aria-label={`Focused ${k}`} />
          <TextInput defaultValue="Off" disabled aria-label={`Off ${k}`} />
        </Row>
        <Row name="label, hint, problem">
          <Field label="Branch" hint="Where the crew commits.">
            <TextInput defaultValue="feature/x" />
          </Field>
          <Field label="Repository" problem="There is no repository by that name.">
            <TextInput defaultValue="acme-portl" aria-invalid="true" />
          </Field>
        </Row>
        <Row name="text area">
          <TextArea rows={3} placeholder="Write to the Foreman…" aria-label={`Message ${k}`} />
        </Row>
        <Row name="select">
          <Select value={model} options={MODELS} onChange={setModel} aria-label={`Model ${k}`} />
          <Select value="" options={MODELS} onChange={setModel} placeholder="Pick a model" aria-label={`Unset ${k}`} />
          <Select value={model} options={MODELS} onChange={setModel} disabled aria-label={`Off model ${k}`} />
        </Row>
        <Row name="number">
          <NumberInput value={n} onChange={setN} min={1} max={20} aria-label={`At once ${k}`} />
          <NumberInput value="1" onChange={() => {}} min={1} max={20} aria-label={`At the least ${k}`} />
          <NumberInput value="5" onChange={() => {}} disabled aria-label={`Off number ${k}`} />
        </Row>
      </Group>

      <Group title="Choices">
        <Row name="radio and check">
          <label className="gallery-choice"><Choice type="radio" name={`r-${k}`} defaultChecked /> On</label>
          <label className="gallery-choice"><Choice type="radio" name={`r-${k}`} /> Off</label>
          <label className="gallery-choice"><Choice type="checkbox" defaultChecked /> Checked</label>
          <label className="gallery-choice"><Choice type="checkbox" /> Not checked</label>
          <label className="gallery-choice"><Choice type="checkbox" disabled /> Off</label>
        </Row>
        <div className="gallery-options">
          <OptionRow type="radio" name={`o-${k}`} checked={pick === 'a'} onChange={() => setPick('a')}>a) The most recently updated one <Chip tone="accent">Recommended</Chip></OptionRow>
          <OptionRow type="radio" name={`o-${k}`} checked={pick === 'b'} onChange={() => setPick('b')}>b) Ask each time</OptionRow>
          <OptionRow type="radio" name={`o-${k}`} disabled>c) Not offered here</OptionRow>
        </div>
      </Group>

      <Group title="Chips and counts">
        <Row name="tones">
          {TONES.map((t) => <Chip key={t} tone={t} icon={t === 'needs-you' ? 'hand' : t === 'info' ? 'loader' : t === 'ok' ? 'check' : t === 'error' ? 'warn' : undefined}>{TONE_WORDS[t]}</Chip>)}
        </Row>
        <Row name="counts">
          <span className="home-view-count">3</span>
          <span className="home-view-count">99+</span>
          <span className="lane-count num">12</span>
          <span className="more-count num">7</span>
          <kbd className="kbd">⌘K</kbd>
          <kbd className="kbd">g i</kbd>
        </Row>
      </Group>

      <Group title="Tooltip and menu">
        <Row name="tooltip">
          <span className="app-tip is-static" role="presentation"><span className="app-tip-text">Start a new job: describe it and pick the repository.</span><span className="app-tip-keys"><kbd className="app-tip-key">c</kbd></span></span>
          <span className="app-tip is-static" role="presentation"><span className="app-tip-text">{LONG}</span></span>
          <Button title="This one shows the real tooltip (key: c).">Hover me</Button>
        </Row>
        <ul className="select-menu is-static" role="presentation">
          <li className="select-option" aria-selected="true"><span className="select-option-label">Opus 5.5</span><Icon name="check" size={14} className="select-check" /></li>
          <li className="select-option is-active"><span className="select-option-label">Sonnet 5 (under the pointer)</span><Icon name="check" size={14} className="select-check" /></li>
          <li className="select-option" aria-disabled="true"><span className="select-option-label">Haiku 5 (off)</span><Icon name="check" size={14} className="select-check" /></li>
        </ul>
      </Group>

      <Group title="Next-step bar">
        <NextBar tone="stop" icon="hand" say="Customer notes tab needs you" sub="Waiting for your go-ahead on the build. 12 jobs need you.">
          <Button kind="primary" size="lg" keyShown keyId="jobs-open">Open</Button>
        </NextBar>
        <NextBar tone="go" icon="clipboard" label="Go / no go" say="Customer merge · plan v2 ready" sub="Say go and the Foreman goes ahead: Build S1–S4, then the tester.">
          <Button size="lg">No go: send back</Button>
          <Button kind="primary" size="lg">Go: approve plan v2</Button>
        </NextBar>
        <NextBar tone="warn" icon="pause" say="Paused" sub="The weekly limit is near; the crew waits until it resets." />
        <NextBar tone="quiet" icon="circle-check" say="Nothing needs you right now" sub="The crew carries on; a job that needs you shows here first." />
      </Group>

      <Group title="Cards">
        <ul className="job-cards gallery-cards">
          <li className="job-card lane-needs-you play-off">
            <div className="job-card-top"><a className="job-card-title" href="#/gallery">Customer notes tab</a></div>
            <span className="job-card-reason">Waiting for your go-ahead on the build</span>
            <div className="job-card-foot"><Chip tone="needs-you" icon="hand">Go-ahead</Chip><span className="muted job-card-time">5h</span></div>
          </li>
          <li className="job-card lane-working play-off">
            <div className="job-card-top"><a className="job-card-title" href="#/gallery">{LONG}</a></div>
            <span className="job-card-reason">Run the database session tests (npm run test:db)</span>
            <div className="job-card-foot"><Chip tone="info" icon="loader">Working</Chip><span className="muted job-card-time">53m</span></div>
          </li>
        </ul>
      </Group>

      <Group title="Detail on request">
        <More screen="gallery" id={`details-${k}`} label="Details" count={4}>
          <p className="muted">History, activity, facts and tables sit here until you ask for them.</p>
        </More>
        {hidden
          ? <HiddenSlot name="Rework, by stage" onShow={() => setHidden(false)} />
          : <div className="gallery-box"><span>Rework, by stage</span><Button kind="quiet" size="sm" icon="eye-off" onClick={() => setHidden(true)}>Hide</Button></div>}
        <details className="gallery-details"><summary>A fold with the app’s chevron</summary><p className="muted">Inside the fold.</p></details>
      </Group>

      <Group title="Empty, loading, error">
        <Hero icon="inbox" title="No tickets yet" actions={<Button kind="primary">Check Orbit now</Button>}>Tickets from Orbit land here, most severe first.</Hero>
        <div className="skeleton-card" aria-label="Loading" role="status"><span className="skeleton-line is-wide" /><span className="skeleton-line" /><span className="skeleton-line is-short" /></div>
        <div className="error-state" role="alert">
          <Icon name="warn" size={16} />
          <div><b>Couldn’t read the tickets</b><span className="muted">Orbit didn’t answer. The app tries again by itself.</span></div>
          <Button size="sm">Try again</Button>
        </div>
      </Group>

      <Group title="Toast and sheet">
        <div className="toast is-static" role="presentation"><Icon name="warn" size={16} /><span>Couldn’t save: the dashboard isn’t answering.</span><Button kind="quiet" size="sm">Dismiss</Button></div>
        <Button onClick={() => setSheet(true)}>Open a sheet</Button>
        {sheet && (
          <Sheet title="A sheet" onClose={() => setSheet(false)}>
            <p className="muted">Dialogs and sheets fade and scale in from 98 %.</p>
            <div className="sheet-actions"><Button onClick={() => setSheet(false)}>Cancel</Button><Button kind="primary" onClick={() => setSheet(false)}>Done</Button></div>
          </Sheet>
        )}
      </Group>
    </div>
  );
}

export function GalleryView() {
  const [theme] = useTheme();
  return (
    <main className="page page-gallery" aria-label="Gallery">
      <div className="page-inner">
        <header className="page-head">
          <h2 className="page-title">Gallery</h2>
          <span className="muted">Every piece in every state · theme: {theme}</span>
        </header>
        <div className="gallery-cols">
          <Column compact={false} />
          <Column compact />
        </div>
        <Group title="Review rounds: the panel’s states and the Desk card"><GalleryReview /></Group>
      </div>
    </main>
  );
}
