// The workshop crew: wooden peg dolls, each with a hat, a paint colour and a tool.
// character(agentType, { state, size, label }) returns an SVG string.
// state: 'working' | 'idle' | 'celebrating' | 'asleep'

const HATS = {
  hardhat: '<path d="M19 21a13 11 0 0 1 26 0z" fill="var(--c-amber)"/><rect x="16" y="20" width="32" height="3.5" rx="1.75" fill="var(--c-amber-deep)"/>',
  beret: '<ellipse cx="31" cy="16.5" rx="13" ry="5" fill="var(--hat)"/><circle cx="31" cy="11" r="1.6" fill="var(--hat)"/>',
  deerstalker: '<path d="M20 20a12 10 0 0 1 24 0z" fill="var(--hat)"/><path d="M20 20h24" stroke="var(--c-ink-soft)" stroke-width="1.2"/><path d="M44 19l6 2-6 1z" fill="var(--hat)"/>',
  flatcap: '<path d="M20 19a12 9 0 0 1 24 0z" fill="var(--hat)"/><path d="M42 18.5q8 0 9 2.5H40z" fill="var(--hat)"/>',
  bandana: '<path d="M20 18a12 10 0 0 1 24 0z" fill="var(--hat)"/><path d="M43 17l6 4-5 1z" fill="var(--hat)"/><circle cx="26" cy="13" r="1" fill="#fff8" /><circle cx="35" cy="12" r="1" fill="#fff8"/>',
  goggles: '<rect x="20" y="17.5" width="24" height="3" rx="1.5" fill="var(--hat)"/><circle cx="27" cy="19" r="3.4" fill="var(--c-glass)" stroke="var(--hat)" stroke-width="1.6"/><circle cx="37" cy="19" r="3.4" fill="var(--c-glass)" stroke="var(--hat)" stroke-width="1.6"/>',
  visor: '<path d="M20 18.5h24v-2a12 6 0 0 0-24 0z" fill="var(--hat)"/><path d="M38 18.5h11l-2 2.5H38z" fill="var(--hat)" opacity=".85"/>',
};

// Tools are drawn around the right hand (about x 46, y 40).
const TOOLS = {
  clipboard: '<rect x="44" y="30" width="11" height="14" rx="1.5" fill="var(--c-wood-dark)"/><rect x="45.5" y="32.5" width="8" height="10" fill="var(--c-paper)"/><rect x="47" y="29" width="5" height="3" rx="1" fill="var(--c-steel)"/><path d="M47 35.5h5M47 38h5M47 40.5h3" stroke="var(--c-ink-soft)" stroke-width=".8"/>',
  quill: '<path d="M46 44l9-15c1 4-1 9-6 13z" fill="var(--c-paper)" stroke="var(--c-ink-soft)" stroke-width=".7"/><path d="M46 44l3-5" stroke="var(--c-ink-soft)" stroke-width="1"/>',
  magnifier: '<circle cx="51" cy="33" r="5" fill="var(--c-glass)" stroke="var(--c-steel)" stroke-width="2"/><path d="M47.5 37l-3.5 5" stroke="var(--c-wood-dark)" stroke-width="2.6" stroke-linecap="round"/>',
  blueprint: '<rect x="44" y="31" width="12" height="11" rx="1" fill="var(--c-blueprint)"/><path d="M46 34h8M46 36.5h5M50 36.5v4" stroke="#fff" stroke-width=".7" opacity=".85"/><circle cx="44" cy="36.5" r="2" fill="var(--c-blueprint)"/>',
  wrench: '<path d="M45 44l8-9" stroke="var(--c-steel)" stroke-width="2.6" stroke-linecap="round"/><path d="M52 31.5a4 4 0 1 0 4.5 4.5l-3 -.5-1-3z" fill="var(--c-steel)"/>',
  flask: '<path d="M48 30h5v4l4 8a2 2 0 0 1-2 3h-9a2 2 0 0 1-2-3l4-8z" fill="var(--c-glass)" stroke="var(--c-steel)" stroke-width="1"/><path d="M45.5 41h10l1 1.6a1.5 1.5 0 0 1-1.4 2.2h-9.2a1.5 1.5 0 0 1-1.4-2.2z" fill="var(--c-moss)"/>',
  check: '<rect x="44" y="30" width="11" height="14" rx="1.5" fill="var(--c-wood-dark)"/><rect x="45.5" y="32.5" width="8" height="10" fill="var(--c-paper)"/><path d="M47 37.5l2 2 3.5-4" stroke="var(--c-moss)" stroke-width="1.5" fill="none"/>',
  key: '<circle cx="51" cy="33" r="3.5" fill="none" stroke="var(--c-amber-deep)" stroke-width="2"/><path d="M49 36l-4 7M46 41l2 1M47.2 39l2 1" stroke="var(--c-amber-deep)" stroke-width="1.8" stroke-linecap="round"/>',
  gauge: '<circle cx="50" cy="37" r="6" fill="var(--c-paper)" stroke="var(--c-steel)" stroke-width="1.5"/><path d="M50 37l3-3" stroke="var(--c-clay)" stroke-width="1.4" stroke-linecap="round"/><path d="M45.5 38.5a5 5 0 0 1 9 0" stroke="var(--c-moss)" fill="none" stroke-width=".9"/>',
  ruler: '<rect x="44" y="30" width="5" height="15" rx="1" fill="var(--c-amber)" transform="rotate(20 46 37)"/><path d="M45.5 33h2M45 35.5h1.5M44.5 38h2M44 40.5h1.5" stroke="var(--c-ink-soft)" stroke-width=".7" transform="rotate(20 46 37)"/>',
  fuse: '<path d="M52 29l-5 8h4l-3 8 8-10h-4l3-6z" fill="var(--c-amber)" stroke="var(--c-amber-deep)" stroke-width=".8"/>',
  brick: '<rect x="44" y="34" width="12" height="7" rx="1" fill="var(--c-clay)"/><path d="M44 37.5h12M50 34v3.5M47 37.5v3.5M53 37.5v3.5" stroke="var(--c-paper)" stroke-width=".7" opacity=".7"/>',
  stopwatch: '<circle cx="50" cy="38" r="6" fill="var(--c-paper)" stroke="var(--c-steel)" stroke-width="1.6"/><rect x="48.8" y="29.5" width="2.4" height="2.5" fill="var(--c-steel)"/><path d="M50 38v-3.5M50 38l2.5 1.5" stroke="var(--c-ink-soft)" stroke-width="1" stroke-linecap="round"/>',
  brush: '<path d="M45 44l7-10" stroke="var(--c-wood-dark)" stroke-width="2.2" stroke-linecap="round"/><path d="M51 35.5l3-4.5 3 2-2.5 4.5z" fill="var(--c-steel)"/><path d="M54 31l3-3 1.5 3.5-1.5 1.5z" fill="var(--c-clay)"/>',
};

const CREW = {
  conductor: { hat: 'hardhat', tool: 'clipboard' },
  'feature-spec-writer': { hat: 'beret', tool: 'quill' },
  'feature-investigator': { hat: 'deerstalker', tool: 'magnifier' },
  'feature-planner': { hat: 'flatcap', tool: 'blueprint' },
  'feature-implementer': { hat: 'bandana', tool: 'wrench' },
  'feature-tester': { hat: 'goggles', tool: 'flask' },
  'feature-reviewer': { hat: 'visor', tool: 'check' },
  'feature-review-permissions': { hat: 'visor', tool: 'key' },
  'feature-review-tests': { hat: 'visor', tool: 'gauge' },
  'feature-review-conventions': { hat: 'visor', tool: 'ruler' },
  'feature-review-errors': { hat: 'visor', tool: 'fuse' },
  'feature-review-db': { hat: 'visor', tool: 'brick' },
  'feature-review-performance': { hat: 'visor', tool: 'stopwatch' },
  'feature-review-ui': { hat: 'visor', tool: 'brush' },
};

// The character who stands at each stage's bench.
export const STAGE_CHARACTER = {
  spec: 'feature-spec-writer',
  refine: 'feature-spec-writer',
  investigate: 'feature-investigator',
  'spec-update': 'feature-spec-writer',
  plan: 'feature-planner',
  implement: 'feature-implementer',
  test: 'feature-tester',
  review: 'feature-reviewer',
  pr1: 'conductor',
  pr2: 'conductor',
  'staging-qa': 'feature-tester',
  pr3: 'conductor',
};

const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

export function character(agentType, { state = 'idle', size = 56, label = '' } = {}) {
  const c = CREW[agentType] || { hat: 'flatcap', tool: 'clipboard' };
  const eyes = state === 'asleep'
    ? '<path d="M26.5 25.5h3M34.5 25.5h3" stroke="var(--c-ink)" stroke-width="1.2" stroke-linecap="round"/>'
    : '<circle class="eye" cx="28" cy="25.5" r="1.3" fill="var(--c-ink)"/><circle class="eye" cx="36" cy="25.5" r="1.3" fill="var(--c-ink)"/>';
  const mouth = state === 'celebrating'
    ? '<path d="M28.5 29.5q3.5 4 7 0z" fill="var(--c-ink)"/>'
    : '<path d="M29 29.5q3 2 6 0" stroke="var(--c-ink)" stroke-width="1.1" fill="none" stroke-linecap="round"/>';
  const confetti = state === 'celebrating'
    ? '<g class="confetti"><rect x="10" y="10" width="3" height="3" fill="var(--c-amber)"/><rect x="52" y="8" width="3" height="3" fill="var(--c-clay)"/><circle cx="14" cy="22" r="1.6" fill="var(--c-moss)"/><circle cx="54" cy="20" r="1.6" fill="var(--c-plum)"/></g>'
    : '';
  const title = label ? `<title>${escapeAttr(label)}</title>` : '';
  const crew = CREW[agentType] ? agentType : 'unknown';
  return `<svg class="char crew-${crew} is-${state}" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${escapeAttr(label || agentType)}">${title}
  <ellipse class="shadow" cx="32" cy="60" rx="15" ry="2.6" fill="var(--c-shadow)"/>
  <g class="figure">
    <path class="body" d="M21 58v-18a11 11 0 0 1 22 0v18z" fill="var(--paint)"/>
    <path d="M21 50h22" stroke="#0002" stroke-width="2"/>
    <circle class="head" cx="32" cy="25" r="10.5" fill="var(--c-wood-light)" stroke="var(--c-wood-grain)" stroke-width=".8"/>
    <circle cx="25.5" cy="28" r="1.7" fill="var(--c-blush)"/><circle cx="38.5" cy="28" r="1.7" fill="var(--c-blush)"/>
    ${eyes}${mouth}
    <g class="hat">${HATS[c.hat]}</g>
    <circle class="hand hand-left" cx="20" cy="43" r="2.6" fill="var(--c-wood-light)" stroke="var(--c-wood-grain)" stroke-width=".6"/>
    <g class="tool">${TOOLS[c.tool]}<circle cx="46" cy="42" r="2.6" fill="var(--c-wood-light)" stroke="var(--c-wood-grain)" stroke-width=".6"/></g>
  </g>${confetti}
</svg>`;
}
