// Pixel-art crew. Every sprite is drawn from small text grids, so it stays crisp at any size.
// sprite(agentType, { state, size, label }) -> SVG string.
// state: 'working' | 'idle' | 'asleep' | 'celebrating' | 'waiting'

// Palette keys -> colours (CSS variables, so day and night themes can recolour them).
const PAL = {
  k: 'var(--px-outline)', s: 'var(--px-wood)', c: 'var(--px-blush)', e: 'var(--px-outline)', m: 'var(--px-outline)',
  h: 'var(--hat)', H: 'var(--hat-shade)', b: 'var(--paint)', B: 'var(--paint-shade)',
  p: 'var(--px-paper)', w: 'var(--px-handle)', t: 'var(--px-metal)', g: 'var(--px-glass)', G: 'var(--px-green)',
  y: 'var(--px-yellow)', r: 'var(--px-red)', u: 'var(--px-blue)', o: 'var(--px-white)',
};

// Half rows (8 columns) are mirrored into 16-column rows.
const mirror = (half) => half + [...half].reverse().join('');

const HATS = {
  cap: ['........', '.....kkk', '....khhh', '...khhhh', '..kHHHHH'],
  hardhat: ['......kk', '....kkhh', '...khhoh', '..khhhhh', 'kkHHHHHH'],
  beret: ['.......k', '....kkkh', '...khhhh', '..khhhhh', '...kHHHH'],
  bandana: ['........', '....kkkk', '...khhhh', '...khohh', '...kHHHH'],
  goggles: ['........', '.....kkk', '....khhh', '...kgghh', '..kHHHHH'],
  deerstalker: ['........', '.....kkk', '....khHh', '...khHhH', '.kkHHHHH'],
  visor: ['........', '........', '....kkkk', '...khhhh', 'kkkHHHHH'],
};

const FACE = {
  open: ['...kssss', '...ksess', '...kcsss', '...ksssm', '....kkkk'],
  closed: ['...kssss', '...ksees', '...kcsss', '...ksssm', '....kkkk'],
  happy: ['...kssss', '...ksess', '...kcsss', '...kssmm', '....kkkk'],
};

const BODY = ['....kbbb', '...kbbbb', '..ksbbbb', '..ksbbbb', '...kbbbb', '...kBBBB', '...kbbbb', '...kbbbb', '...kkkkk'];
// Arms up for celebrating: hands beside the head.
const BODY_CHEER = ['..kkbbbb', '.ksbbbbb', '..kbbbbb', '...kbbbb', '...kbbbb', '...kBBBB', '...kbbbb', '...kbbbb', '...kkkkk'];

// Tools: 6 x 7 grids drawn at the right hand. Frame "up" is raised, frame "down" is the strike.
const TOOLS = {
  clipboard: ['kktkk.', 'kppppk', 'kpkkpk', 'kppppk', 'kpkkpk', 'kppppk', 'kkkkkk'],
  quill: ['....kk', '...kyk', '..kyk.', '.kyk..', 'krk...', 'kk....', '......'],
  magnifier: ['.kkk..', 'kgggk.', 'kgogk.', 'kgggk.', '.kkkw.', '....w.', '....w.'],
  blueprint: ['kkkkkk', 'kuuuuk', 'kuouuk', 'kuuouk', 'kuoouk', 'kkkkkk', '......'],
  hammer: ['kkkkk.', 'kttttk', 'kkkkk.', '..kw..', '..kw..', '..kw..', '..kw..'],
  flask: ['.kkk..', '.kgk..', 'kgggk.', 'kgggk.', 'kGGGk.', 'kGGGk.', '.kkk..'],
  check: ['kktkk.', 'kppppk', 'kpppGk', 'kGpGpk', 'kpGppk', 'kppppk', 'kkkkkk'],
  key: ['.kk...', 'kyyk..', 'kyyk..', '.kk...', '..yk..', '..yy..', '..yk..'],
  gauge: ['.kkkk.', 'kppppk', 'kpprpk', 'kprppk', 'kGpppk', '.kkkk.', '......'],
  ruler: ['yk....', 'yk....', 'ykk...', 'yk....', 'ykk...', 'yk....', 'ykk...'],
  fuse: ['...yy.', '..yy..', '.yyyy.', '...yy.', '..yy..', '.yy...', '......'],
  brick: ['......', 'kkkkkk', 'krrkrk', 'kkkkkk', 'krkrrk', 'kkkkkk', '......'],
  stopwatch: ['..tt..', '.kkkk.', 'kppppk', 'kpkppk', 'kppkpk', '.kkkk.', '......'],
  brush: ['...rr.', '...rr.', '...tt.', '...ww.', '..ww..', '.ww...', 'ww....'],
};

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

// The character who stands at each stage's station.
export const STAGE_CHARACTER = {
  spec: 'feature-spec-writer', refine: 'feature-spec-writer', investigate: 'feature-investigator',
  'spec-update': 'feature-spec-writer', plan: 'feature-planner', implement: 'feature-implementer',
  test: 'feature-tester', review: 'feature-reviewer', pr1: 'conductor', pr2: 'conductor',
  'staging-qa': 'feature-tester', pr3: 'conductor',
};

// Turn grid rows into <rect>s, merging runs of the same colour.
function pixels(rows, x0 = 0, y0 = 0) {
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) { x++; continue; }
      let run = 1;
      while (row[x + run] === ch) run++;
      out += `<rect x="${x0 + x}" y="${y0 + y}" width="${run}" height="1" fill="${PAL[ch]}"/>`;
      x += run;
    }
  });
  return out;
}

const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

// The sprite sits in a 24 x 24 box: body at (4, 3), tool around the right hand.
function figure(c, { face, body, tool, toolDy = 0, sparks = false }) {
  const rows = [...HATS[c.hat].map(mirror), ...FACE[face].map(mirror), ...body.map(mirror)];
  let svg = pixels(rows, 4, 3);
  if (tool) svg += pixels(TOOLS[c.tool], 15, 9 + toolDy);
  if (sparks) svg += pixels(['y.o', '.y.', 'o.y'], 20, 14);
  return svg;
}

export function sprite(agentType, { state = 'idle', size = 48, label = '' } = {}) {
  const key = CREW[agentType] ? agentType : 'unknown';
  const c = CREW[agentType] || { hat: 'cap', tool: 'clipboard' };
  let frames;
  if (state === 'working') {
    // Two frames: tool raised, then the strike with sparks.
    frames = `<g class="fa">${figure(c, { face: 'open', body: BODY, tool: true, toolDy: -2 })}</g>`
      + `<g class="fb">${figure(c, { face: 'closed', body: BODY, tool: true, toolDy: 2, sparks: true })}</g>`;
  } else if (state === 'celebrating') {
    frames = `<g class="fa">${figure(c, { face: 'happy', body: BODY_CHEER, tool: false })}</g>`
      + `<g class="fb">${figure(c, { face: 'happy', body: BODY, tool: true })}</g>`;
  } else if (state === 'asleep') {
    frames = `<g>${figure(c, { face: 'closed', body: BODY, tool: false })}</g>`;
  } else {
    // idle / waiting: blink now and then.
    frames = `<g class="fa">${figure(c, { face: 'open', body: BODY, tool: true })}</g>`
      + `<g class="fb">${figure(c, { face: 'closed', body: BODY, tool: true })}</g>`;
  }
  const title = label ? `<title>${escapeAttr(label)}</title>` : '';
  return `<svg class="sprite crew-${key} is-${state}" viewBox="0 0 24 24" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${escapeAttr(label || agentType)}">${title}<ellipse class="shadow" cx="12" cy="22.3" rx="6" ry="1.2" fill="var(--px-shadow)"/><g class="body">${frames}</g></svg>`;
}

// Small icons for the HUD, same pixel style. 8 x 8.
const ICONS = {
  coin: ['..kkkk..', '.kyyyyk.', 'kyyoyyyk', 'kyoyyyyk', 'kyyyyyyk', 'kyyyyyyk', '.kyyyyk.', '..kkkk..'],
  calendar: ['.k....k.', 'kkkkkkkk', 'krrrrrrk', 'kkkkkkkk', 'kpkpkpkk', 'kkkkkkkk', 'kpkpkpkk', 'kkkkkkkk'],
  bang: ['..kkkk..', '..krrk..', '..krrk..', '..krrk..', '..krrk..', '..kkkk..', '..krrk..', '..kkkk..'],
  bolt: ['....kkk.', '...kyyk.', '..kyyk..', '.kyyyyk.', '.kkyyk..', '..kyk...', '..kk....', '..k.....'],
  badge: ['..kkkk..', '.kyyyyk.', 'kyyooyyk', 'kyoyyoyk', 'kyyooyyk', '.kyyyyk.', '.kr..rk.', '.kk..kk.'],
  zzz: ['kkkk....', '...k....', '..k.....', '.k......', 'kkkk.kkk', '.......k', '......k.', '.....kkk'],
};
export function icon(name, size = 20) {
  return `<svg class="icon" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${pixels(ICONS[name])}</svg>`;
}
