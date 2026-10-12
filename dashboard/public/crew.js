// The workshop crew, drawn as smooth vector characters with a simple rig (body, head, arms, feet)
// so CSS can animate them with real motion: squash and stretch, swings, blinks and particles.
// sprite(agentType, { state, size, label }) -> SVG string.
// state: 'working' | 'idle' | 'waiting' | 'asleep' | 'celebrating' | 'walking'

const HATS = {
  hardhat: `<path d="M38 37C38 22 47 15 60 15S82 22 82 37Z" fill="var(--hat)"/><rect x="34" y="34" width="52" height="6.5" rx="3.2" fill="var(--hat-shade)"/><rect x="57" y="15.6" width="6" height="19" rx="3" fill="#fff" opacity=".3"/><circle cx="60" cy="27" r="3.3" fill="#fff" opacity=".55"/>`,
  beret: `<ellipse cx="57" cy="23" rx="24.5" ry="8.6" transform="rotate(-10 57 23)" fill="var(--hat)"/><ellipse cx="54" cy="20.5" rx="14" ry="3.6" transform="rotate(-10 54 20.5)" fill="#fff" opacity=".18"/><circle cx="58" cy="13.6" r="3.1" fill="var(--hat-shade)"/>`,
  deerstalker: `<path d="M40 30Q28 31 26 35.5H41ZM80 30Q92 31 94 35.5H79Z" fill="var(--hat-shade)"/><path d="M39 34C39 21 48 16 60 16S81 21 81 34Z" fill="var(--hat)"/><path d="M46 19V33M53 16.8V33M60 16V33M67 16.8V33M74 19V33M40.5 26H79.5" stroke="var(--hat-shade)" stroke-width="1.3" opacity=".55"/><circle cx="60" cy="16" r="2.6" fill="var(--hat-shade)"/>`,
  cap: `<path d="M76 31C86 30 95 32 97.5 36.5H76.5Z" fill="var(--hat-shade)"/><path d="M39 34.5C39 21 48 16 60 16S81 21 81 34.5Z" fill="var(--hat)"/><circle cx="60" cy="16.6" r="2.2" fill="var(--hat-shade)"/><path d="M47 22Q53 18 60 18" stroke="#fff" stroke-width="2" opacity=".3" stroke-linecap="round" fill="none"/>`,
  bandana: `<path d="M80 29.5 92.5 24.5 90.5 33.5ZM80 31 91.5 36.5 86.5 39.5Z" fill="var(--hat-shade)"/><path d="M38.5 33C39 20 48 15 60 15S81 20 81.5 33C70 29 50 29 38.5 33Z" fill="var(--hat)"/><g fill="#fff" opacity=".85"><circle cx="48" cy="24.5" r="1.5"/><circle cx="56.5" cy="20" r="1.5"/><circle cx="65.5" cy="21.5" r="1.5"/><circle cx="73" cy="26.5" r="1.5"/><circle cx="53" cy="28" r="1.5"/><circle cx="62" cy="27" r="1.5"/></g>`,
  goggles: `<path d="M39.5 33C40 21 48 17 60 17S80 21 80.5 33Z" fill="var(--hat-shade)" opacity=".55"/><path d="M38.5 29Q60 22.5 81.5 29V34.5Q60 28 38.5 34.5Z" fill="var(--hat-shade)"/><circle cx="51" cy="29.6" r="6.6" fill="var(--glass)" stroke="var(--hat)" stroke-width="2.6"/><circle cx="69" cy="29.6" r="6.6" fill="var(--glass)" stroke="var(--hat)" stroke-width="2.6"/><path d="M47.5 27.5Q49 25.6 51.5 25.4M65.5 27.5Q67 25.6 69.5 25.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
  visor: `<path d="M38.5 31Q60 24.5 81.5 31V35.5Q60 29 38.5 35.5Z" fill="var(--hat-shade)"/><path d="M36.5 34.5Q60 27.5 83.5 34.5L90.5 41.5Q60 34 29.5 41.5Z" fill="var(--hat)" opacity=".94"/><path d="M42 36Q60 31.5 78 36" stroke="#fff" stroke-width="1.4" opacity=".35" fill="none"/>`,
};

// Tools are drawn with the hand at (0, 0), held upright.
const TOOLS = {
  clipboard: `<rect x="-3" y="-25" width="21" height="26" rx="3" fill="var(--wood-dark)"/><rect x="-0.5" y="-21" width="16" height="20" rx="1.5" fill="#fff"/><rect x="3.5" y="-28" width="8" height="5.5" rx="2.2" fill="var(--metal)"/><path d="M2 -16H13M2 -12H13M2 -8H9" stroke="#9aa3b8" stroke-width="1.5" stroke-linecap="round"/>`,
  check: `<rect x="-3" y="-25" width="21" height="26" rx="3" fill="var(--wood-dark)"/><rect x="-0.5" y="-21" width="16" height="20" rx="1.5" fill="#fff"/><rect x="3.5" y="-28" width="8" height="5.5" rx="2.2" fill="var(--metal)"/><path d="M2.5 -11 6 -7.5 12.5 -15" stroke="var(--ok-green)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  quill: `<path d="M0 0C6 -9 12 -21 21 -31C18 -20 11 -10 2.5 -1.5Z" fill="#fff" stroke="#c8cfe0" stroke-width="1.2"/><path d="M2 -2C8 -10 13 -19 19 -28" stroke="#c8cfe0" stroke-width="1" fill="none"/><path d="M-1 1 1.5 -2.5 3 -0.5Z" fill="var(--ink-face)"/>`,
  magnifier: `<path d="M1 0 4.5 -13" stroke="var(--wood-dark)" stroke-width="4.6" stroke-linecap="round"/><circle cx="8.5" cy="-22" r="9.5" fill="var(--glass)" stroke="var(--metal)" stroke-width="3.4"/><path d="M4 -25Q6 -28.5 10 -28.8" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  blueprint: `<rect x="-4" y="-24" width="24" height="17" rx="2" fill="var(--blueprint)"/><path d="M0 -19H14M0 -15H9M11 -15V-10" stroke="#fff" stroke-width="1.3" opacity=".9" stroke-linecap="round"/><rect x="-6" y="-26" width="5" height="21" rx="2.5" fill="var(--blueprint-dark)"/>`,
  hammer: `<rect x="-2.3" y="-31" width="4.6" height="33" rx="2.3" fill="var(--wood-dark)"/><rect x="-10" y="-38" width="20" height="10" rx="2.8" fill="var(--metal)"/><rect x="-8" y="-36.5" width="16" height="2.4" rx="1.2" fill="#fff" opacity=".45"/>`,
  flask: `<path d="M2.5 -31H11.5V-21L19.5 -5C21 -1.5 18.5 2 15 2H-1C-4.5 2 -7 -1.5 -5.5 -5L2.5 -21Z" fill="var(--glass)" stroke="var(--metal)" stroke-width="2"/><path d="M-3.4 -8.5H17.4L19.5 -5C21 -1.5 18.5 2 15 2H-1C-4.5 2 -7 -1.5 -5.5 -5Z" fill="var(--ok-green)" opacity=".85"/><circle class="bub b1" cx="4" cy="-5" r="1.6" fill="#fff"/><circle class="bub b2" cx="9" cy="-3" r="1.2" fill="#fff"/><circle class="bub b3" cx="12" cy="-6" r="1.4" fill="#fff"/><rect x="1" y="-34" width="12" height="4" rx="2" fill="var(--metal)"/>`,
  key: `<circle cx="4" cy="-25" r="6.5" fill="none" stroke="var(--gold)" stroke-width="3.6"/><rect x="2.2" y="-19" width="3.6" height="20" rx="1.6" fill="var(--gold)"/><rect x="5" y="-6" width="5" height="3" rx="1" fill="var(--gold)"/><rect x="5" y="-1.5" width="3.5" height="2.8" rx="1" fill="var(--gold)"/>`,
  gauge: `<circle cx="6" cy="-17" r="11.5" fill="#fff" stroke="var(--metal)" stroke-width="2.8"/><path d="M-1.5 -14A8 8 0 0 1 13.5 -14" stroke="var(--ok-green)" stroke-width="2" fill="none"/><path class="needle" d="M6 -17 11 -23" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round"/><circle cx="6" cy="-17" r="1.8" fill="var(--ink-face)"/>`,
  ruler: `<rect x="-2.5" y="-34" width="8" height="36" rx="1.8" fill="var(--gold)"/><path d="M-2.5 -28H1M-2.5 -22H2.5M-2.5 -16H1M-2.5 -10H2.5M-2.5 -4H1" stroke="var(--wood-dark)" stroke-width="1.3"/>`,
  fuse: `<path d="M9 -36 -2 -15H6L0 2 15 -21H6.5L13 -36Z" fill="var(--gold)" stroke="var(--gold-dark)" stroke-width="1.6" stroke-linejoin="round"/>`,
  brick: `<rect x="-9" y="-15" width="21" height="12" rx="2" fill="var(--clay)"/><path d="M-9 -9H12M1.5 -15V-9M-4 -9V-3M7 -9V-3" stroke="#fff" stroke-width="1.2" opacity=".6"/>`,
  stopwatch: `<rect x="3" y="-31" width="6" height="4.5" rx="1.5" fill="var(--metal)"/><circle cx="6" cy="-17" r="11" fill="#fff" stroke="var(--metal)" stroke-width="2.8"/><path class="needle" d="M6 -17V-24.5" stroke="var(--ink-face)" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="-17" r="1.6" fill="var(--danger)"/>`,
  brush: `<rect x="-1.8" y="-22" width="4" height="24" rx="2" transform="rotate(14)" fill="var(--wood-dark)"/><rect x="2" y="-30" width="6" height="7" rx="1" transform="rotate(14)" fill="var(--metal)"/><path d="M3.4 -38C3.4 -38 10 -36 9.6 -30.5L3 -31.6Z" fill="var(--paint-2)"/>`,
};

// How each tool is used: decides the working animation.
const MOTION = { hammer: 'strike', brick: 'strike', check: 'strike', key: 'strike', clipboard: 'strike', quill: 'write', brush: 'write', ruler: 'write', blueprint: 'write', magnifier: 'scan', gauge: 'scan', stopwatch: 'scan', flask: 'shake', fuse: 'shake' };

const CREW = {
  conductor: { hat: 'hardhat', tool: 'clipboard' },
  'feature-spec-writer': { hat: 'beret', tool: 'quill' },
  'feature-investigator': { hat: 'deerstalker', tool: 'magnifier' },
  'feature-planner': { hat: 'cap', tool: 'blueprint' },
  'feature-implementer': { hat: 'bandana', tool: 'hammer' },
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

// The character who stands at each stage.
export const STAGE_CHARACTER = {
  spec: 'feature-spec-writer', refine: 'feature-spec-writer', investigate: 'feature-investigator',
  'spec-update': 'feature-spec-writer', plan: 'feature-planner', implement: 'feature-implementer',
  test: 'feature-tester', review: 'feature-reviewer', pr1: 'conductor', pr2: 'conductor',
  'staging-qa': 'feature-tester', pr3: 'conductor',
};

const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

function eyes(state) {
  if (state === 'asleep') return '<path d="M48.5 43Q52 46.5 55.5 43M64.5 43Q68 46.5 71.5 43" stroke="var(--ink-face)" stroke-width="2.2" stroke-linecap="round" fill="none"/>';
  if (state === 'celebrating') return '<path d="M48.5 44Q52 39 55.5 44M64.5 44Q68 39 71.5 44" stroke="var(--ink-face)" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
  const ry = state === 'working' ? 2.7 : state === 'waiting' ? 4 : 3.5;
  return `<g class="eyes"><ellipse cx="52" cy="42" rx="2.8" ry="${ry}" fill="var(--ink-face)"/><ellipse cx="68" cy="42" rx="2.8" ry="${ry}" fill="var(--ink-face)"/><circle cx="53.1" cy="40.4" r="1.1" fill="#fff"/><circle cx="69.1" cy="40.4" r="1.1" fill="#fff"/></g>`;
}

function mouth(state) {
  if (state === 'celebrating' || state === 'waiting') return '<path d="M55 49.5Q60 57.5 65 49.5Z" fill="var(--ink-face)"/><path d="M57.3 53.4Q60 55.6 62.7 53.4" stroke="#f08080" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
  if (state === 'working') return '<path d="M56.5 51.2Q60 52.6 63.5 51.2" stroke="var(--ink-face)" stroke-width="2" stroke-linecap="round" fill="none"/>';
  if (state === 'asleep') return '<ellipse cx="60" cy="51.5" rx="2" ry="2.4" fill="var(--ink-face)" opacity=".8"/>';
  return '<path d="M55.5 50Q60 54.2 64.5 50" stroke="var(--ink-face)" stroke-width="2" stroke-linecap="round" fill="none"/>';
}

function effects(state, motion) {
  if (state === 'working') {
    const sparks = motion === 'strike'
      ? '<g class="sparks"><path class="spark s1" d="M101 86l1.4 3.2 3.2 1.4-3.2 1.4-1.4 3.2-1.4-3.2-3.2-1.4 3.2-1.4z" fill="var(--spark)"/><path class="spark s2" d="M108 94l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="var(--spark)"/><path class="spark s3" d="M96 96l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="#fff"/></g>'
      : '';
    return `${sparks}<path class="sweat" d="M83 26c2 3.2 3 5 3 6.4a3 3 0 0 1-6 0c0-1.4 1-3.2 3-6.4z" fill="var(--glass)" stroke="#7fb8d6" stroke-width=".8"/>`;
  }
  if (state === 'asleep') return '<g class="zzz" fill="var(--zzz)" font-family="ui-rounded, system-ui, sans-serif" font-weight="900"><text class="z1" x="80" y="26" font-size="10">z</text><text class="z2" x="87" y="17" font-size="13">z</text><text class="z3" x="95" y="7" font-size="16">Z</text></g>';
  if (state === 'celebrating') return '<g class="confetti"><rect class="c1" x="24" y="10" width="5" height="3" rx="1" fill="var(--c-amber)"/><rect class="c2" x="40" y="4" width="4" height="4" rx="1" fill="var(--c-plum)"/><rect class="c3" x="78" y="6" width="5" height="3" rx="1" fill="var(--c-blueprint)"/><rect class="c4" x="92" y="12" width="4" height="4" rx="1" fill="var(--c-moss)"/><rect class="c5" x="58" y="0" width="5" height="3" rx="1" fill="var(--c-clay)"/><rect class="c6" x="16" y="22" width="4" height="4" rx="1" fill="var(--c-teal)"/></g>';
  return '';
}

export function sprite(agentType, { state = 'idle', size = 64, label = '' } = {}) {
  const key = CREW[agentType] ? agentType : 'unknown';
  const c = CREW[agentType] || { hat: 'cap', tool: 'clipboard' };
  const motion = MOTION[c.tool] ?? 'strike';
  const title = label ? `<title>${escapeAttr(label)}</title>` : '';
  return `<svg class="ch crew-${key} is-${state} m-${motion}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${escapeAttr(label || agentType)}">${title}
<ellipse class="shadow" cx="60" cy="110" rx="25" ry="4.6" fill="var(--ch-shadow)"/>
<g class="rig">
  <g class="feet"><ellipse class="foot foot-l" cx="51" cy="105.5" rx="7.4" ry="4.2" fill="var(--ch-feet)"/><ellipse class="foot foot-r" cx="69" cy="105.5" rx="7.4" ry="4.2" fill="var(--ch-feet)"/></g>
  <g class="arm arm-l"><path d="M45 64 38 86" stroke="var(--paint-arm)" stroke-width="9.5" stroke-linecap="round"/><circle cx="38" cy="87.5" r="5.4" fill="var(--skin)" stroke="var(--skin-shade)" stroke-width="1"/></g>
  <path class="torso" d="M44 66C44 60 49 58 54 58H66C71 58 76 60 76 66L79 96C79.6 101 76 104 71 104H49C44 104 40.4 101 41 96Z" fill="var(--paint)"/>
  <path d="M42.2 86H77.8L78.3 91.2H41.7Z" fill="var(--paint-shade)" opacity=".75"/>
  <ellipse cx="51.5" cy="70" rx="4.6" ry="8" fill="#fff" opacity=".2"/>
  <g class="head">
    <circle cx="60" cy="40" r="21.5" fill="var(--skin)" stroke="var(--skin-shade)" stroke-width="1.2"/>
    <ellipse cx="51.5" cy="30.5" rx="7.5" ry="5" fill="#fff" opacity=".32"/>
    <ellipse cx="46.8" cy="47.5" rx="4.3" ry="2.6" fill="var(--blush)" opacity=".75"/><ellipse cx="73.2" cy="47.5" rx="4.3" ry="2.6" fill="var(--blush)" opacity=".75"/>
    ${eyes(state)}${mouth(state)}
    <g class="hat">${HATS[c.hat]}</g>
  </g>
  <g class="arm arm-r"><path d="M75 64 83 86" stroke="var(--paint-arm)" stroke-width="9.5" stroke-linecap="round"/><g class="tool" transform="translate(84.5 87)">${TOOLS[c.tool]}</g><circle cx="84" cy="87.5" r="5.4" fill="var(--skin)" stroke="var(--skin-shade)" stroke-width="1"/></g>
</g>
<g class="fx">${effects(state, motion)}</g>
</svg>`;
}

// Small icons for the numbers row.
const ICONS = {
  coin: '<circle cx="12" cy="12" r="9" fill="var(--gold)" stroke="var(--gold-dark)" stroke-width="2"/><path d="M12 7.5v9M14.6 9.3c-.6-.8-1.6-1.2-2.7-1.2-1.5 0-2.6.8-2.6 1.9 0 2.6 5.6 1.4 5.6 4.1 0 1.1-1.2 1.9-2.8 1.9-1.2 0-2.3-.5-2.9-1.4" stroke="var(--gold-dark)" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="#fff" stroke="var(--icon-ink)" stroke-width="2"/><path d="M3.5 10h17" stroke="var(--icon-ink)" stroke-width="2"/><rect x="3.5" y="5" width="17" height="5" rx="2" fill="var(--danger)"/><path d="M8 3v4M16 3v4" stroke="var(--icon-ink)" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="14.5" r="1.3" fill="var(--icon-ink)"/><circle cx="15" cy="14.5" r="1.3" fill="var(--icon-ink)"/>',
  bang: '<circle cx="12" cy="12" r="10" fill="var(--danger)"/><path d="M12 6.5v7" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.7" fill="#fff"/>',
  bolt: '<circle cx="12" cy="12" r="10" fill="var(--ok-green)"/><path d="M13.2 4.8 7.6 13h4.2l-1 6.2 5.6-8.2h-4.2z" fill="#fff"/>',
  badge: '<path d="M8 13.5 6 21l4-1.8L12 22l2-2.8 4 1.8-2-7.5" fill="var(--danger)"/><circle cx="12" cy="10" r="7.5" fill="var(--gold)" stroke="var(--gold-dark)" stroke-width="2"/><path d="m12 6.4 1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" fill="#fff"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 1.8H4.4z" fill="currentColor"/><circle cx="12" cy="20.3" r="2" fill="currentColor"/>',
};
export function icon(name, size = 22) {
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

// ---------- The map: a path through a meadow with one station per stage ----------

const SHORT = { spec: 'Spec', refine: 'Refine', investigate: 'Invest.', 'spec-update': 'Update', plan: 'Plan', implement: 'Build', test: 'Test', review: 'Review', pr1: 'PR 1', pr2: 'PR 2', 'staging-qa': 'QA', pr3: 'PR 3' };
const LONG = { ...SHORT, investigate: 'Investigate', 'spec-update': 'Spec update', 'staging-qa': 'Staging QA' };
export const stageShort = (id) => LONG[id] ?? id;

const BUBBLES = {
  bang: '<span class="bubble bang" aria-hidden="true">!</span>',
  dots: '<span class="bubble dots" aria-hidden="true"><i></i><i></i><i></i></span>',
  quiet: '<span class="bubble quiet" aria-hidden="true">…?</span>',
  badge: '<span class="bubble badge" aria-hidden="true">★</span>',
  key: '<span class="bubble key" aria-hidden="true">?</span>',
};
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.6 11.5 12.5 4.8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

/**
 * stages: [{id,label,tip}], f: job (stage, stageState, skipped), sit: { tone, crew: [{who}], bubble },
 * agentName(type) for labels. Returns the map HTML.
 */
export function renderMap(stages, f, sit, { agentName, size = 76, coins = '', long = false } = {}) {
  const ids = stages.map((s) => s.id);
  const at = f.stageState === 'done' ? ids.length - 1 : ids.indexOf(f.stage);
  const state = { working: 'working', needs: 'waiting', done: 'celebrating', blocked: 'idle', idle: 'asleep' }[sit.tone] ?? 'idle';
  return `<div class="map tone-${sit.tone}" data-at="${at}">
    <span class="cloud cl1" aria-hidden="true"></span><span class="cloud cl2" aria-hidden="true"></span>
    <span class="fly f1" aria-hidden="true"></span><span class="fly f2" aria-hidden="true"></span><span class="fly f3" aria-hidden="true"></span><span class="fly f4" aria-hidden="true"></span>
    <span class="tree t1" aria-hidden="true"></span><span class="tree t2" aria-hidden="true"></span>
    ${coins}
    <ol class="stations" aria-label="Stages">${stages.map((st, i) => {
      let cls = 'todo';
      let label = 'not started yet';
      if (f.skipped?.includes(st.id)) { cls = 'skipped'; label = 'skipped on this route'; }
      else if (i === at) { cls = f.stageState === 'done' ? 'done current' : 'current'; label = f.stageState === 'done' ? 'finished' : 'current stage'; }
      else if (at > -1 && i < at) { cls = 'done'; label = 'done'; }
      let actor = '';
      if (i === at) {
        const crew = sit.crew?.length ? sit.crew.slice(0, 3).map((a) => a.who) : [STAGE_CHARACTER[st.id] ?? 'conductor'];
        const names = crew.map((w) => agentName?.(w) ?? w).join(', ');
        actor = `<span class="actor n${crew.length}" data-stage="${i}">${crew.map((w, k) => `<span class="slot k${k}">${sprite(w, { state, size, label: `${agentName?.(w) ?? w}${state === 'working' ? ', working' : ''}` })}</span>`).join('')}${sit.bubble ? BUBBLES[sit.bubble] : ''}${state === 'working' ? '<span class="puffs" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<span class="visually-hidden">${names}</span></span>`;
      }
      return `<li class="station ${cls}" title="${escapeAttr(`${st.label}: ${label}. ${st.tip}`)}">${actor}<span class="node">${cls.startsWith('done') ? CHECK : ''}</span><span class="name">${(long ? LONG : SHORT)[st.id] ?? st.label}</span></li>`;
    }).join('')}</ol>
  </div>`;
}
