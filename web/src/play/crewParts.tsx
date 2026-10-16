// The crew rig's parts as SVG elements, ported shape for shape from dashboard/public/crew.js:
// seven hats, fourteen tools (drawn with the hand at 0,0), eyes, mouths and effects per mood.
// Every colour is a --crew-* custom property (theme/tokens.ts CREW_TOKENS; themes restyle them),
// so nothing here is a fixed colour. Static shapes only: nothing takes text or markup from outside.
import type { ReactElement } from 'react';
import type { CrewState, HatId, Motion, ToolId } from './crew';

const v = (name: string) => `var(--crew-${name})`;
const HAT = v('hat');
const HAT_SHADE = v('hat-shade');
const SHINE = v('shine');
const PAPER = v('paper');
const INK = v('ink');

export const HATS: Record<HatId, ReactElement> = {
  hardhat: (
    <>
      <path d="M38 37C38 22 47 15 60 15S82 22 82 37Z" fill={HAT} />
      <rect x="34" y="34" width="52" height="6.5" rx="3.2" fill={HAT_SHADE} />
      <rect x="57" y="15.6" width="6" height="19" rx="3" fill={SHINE} opacity=".3" />
      <circle cx="60" cy="27" r="3.3" fill={SHINE} opacity=".55" />
    </>
  ),
  beret: (
    <>
      <ellipse cx="57" cy="23" rx="24.5" ry="8.6" transform="rotate(-10 57 23)" fill={HAT} />
      <ellipse cx="54" cy="20.5" rx="14" ry="3.6" transform="rotate(-10 54 20.5)" fill={SHINE} opacity=".18" />
      <circle cx="58" cy="13.6" r="3.1" fill={HAT_SHADE} />
    </>
  ),
  deerstalker: (
    <>
      <path d="M40 30Q28 31 26 35.5H41ZM80 30Q92 31 94 35.5H79Z" fill={HAT_SHADE} />
      <path d="M39 34C39 21 48 16 60 16S81 21 81 34Z" fill={HAT} />
      <path d="M46 19V33M53 16.8V33M60 16V33M67 16.8V33M74 19V33M40.5 26H79.5" stroke={HAT_SHADE} strokeWidth="1.3" opacity=".55" />
      <circle cx="60" cy="16" r="2.6" fill={HAT_SHADE} />
    </>
  ),
  cap: (
    <>
      <path d="M76 31C86 30 95 32 97.5 36.5H76.5Z" fill={HAT_SHADE} />
      <path d="M39 34.5C39 21 48 16 60 16S81 21 81 34.5Z" fill={HAT} />
      <circle cx="60" cy="16.6" r="2.2" fill={HAT_SHADE} />
      <path d="M47 22Q53 18 60 18" stroke={SHINE} strokeWidth="2" opacity=".3" strokeLinecap="round" fill="none" />
    </>
  ),
  bandana: (
    <>
      <path d="M80 29.5 92.5 24.5 90.5 33.5ZM80 31 91.5 36.5 86.5 39.5Z" fill={HAT_SHADE} />
      <path d="M38.5 33C39 20 48 15 60 15S81 20 81.5 33C70 29 50 29 38.5 33Z" fill={HAT} />
      <g fill={SHINE} opacity=".85">
        <circle cx="48" cy="24.5" r="1.5" /><circle cx="56.5" cy="20" r="1.5" /><circle cx="65.5" cy="21.5" r="1.5" />
        <circle cx="73" cy="26.5" r="1.5" /><circle cx="53" cy="28" r="1.5" /><circle cx="62" cy="27" r="1.5" />
      </g>
    </>
  ),
  goggles: (
    <>
      <path d="M39.5 33C40 21 48 17 60 17S80 21 80.5 33Z" fill={HAT_SHADE} opacity=".55" />
      <path d="M38.5 29Q60 22.5 81.5 29V34.5Q60 28 38.5 34.5Z" fill={HAT_SHADE} />
      <circle cx="51" cy="29.6" r="6.6" fill={v('glass')} stroke={HAT} strokeWidth="2.6" />
      <circle cx="69" cy="29.6" r="6.6" fill={v('glass')} stroke={HAT} strokeWidth="2.6" />
      <path d="M47.5 27.5Q49 25.6 51.5 25.4M65.5 27.5Q67 25.6 69.5 25.4" stroke={SHINE} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  visor: (
    <>
      <path d="M38.5 31Q60 24.5 81.5 31V35.5Q60 29 38.5 35.5Z" fill={HAT_SHADE} />
      <path d="M36.5 34.5Q60 27.5 83.5 34.5L90.5 41.5Q60 34 29.5 41.5Z" fill={HAT} opacity=".94" />
      <path d="M42 36Q60 31.5 78 36" stroke={SHINE} strokeWidth="1.4" opacity=".35" fill="none" />
    </>
  ),
};

const CLIPBOARD_BACK = (
  <>
    <rect x="-3" y="-25" width="21" height="26" rx="3" fill={v('wood')} />
    <rect x="-0.5" y="-21" width="16" height="20" rx="1.5" fill={PAPER} />
    <rect x="3.5" y="-28" width="8" height="5.5" rx="2.2" fill={v('metal')} />
  </>
);

export const TOOLS: Record<ToolId, ReactElement> = {
  clipboard: (
    <>
      {CLIPBOARD_BACK}
      <path d="M2 -16H13M2 -12H13M2 -8H9" stroke={v('line')} strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  check: (
    <>
      {CLIPBOARD_BACK}
      <path d="M2.5 -11 6 -7.5 12.5 -15" stroke={v('ok')} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  quill: (
    <>
      <path d="M0 0C6 -9 12 -21 21 -31C18 -20 11 -10 2.5 -1.5Z" fill={PAPER} stroke={v('line')} strokeWidth="1.2" />
      <path d="M2 -2C8 -10 13 -19 19 -28" stroke={v('line')} strokeWidth="1" fill="none" />
      <path d="M-1 1 1.5 -2.5 3 -0.5Z" fill={INK} />
    </>
  ),
  magnifier: (
    <>
      <path d="M1 0 4.5 -13" stroke={v('wood')} strokeWidth="4.6" strokeLinecap="round" />
      <circle cx="8.5" cy="-22" r="9.5" fill={v('glass')} stroke={v('metal')} strokeWidth="3.4" />
      <path d="M4 -25Q6 -28.5 10 -28.8" stroke={SHINE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  blueprint: (
    <>
      <rect x="-4" y="-24" width="24" height="17" rx="2" fill={v('blueprint')} />
      <path d="M0 -19H14M0 -15H9M11 -15V-10" stroke={SHINE} strokeWidth="1.3" opacity=".9" strokeLinecap="round" />
      <rect x="-6" y="-26" width="5" height="21" rx="2.5" fill={v('blueprint-dark')} />
    </>
  ),
  hammer: (
    <>
      <rect x="-2.3" y="-31" width="4.6" height="33" rx="2.3" fill={v('wood')} />
      <rect x="-10" y="-38" width="20" height="10" rx="2.8" fill={v('metal')} />
      <rect x="-8" y="-36.5" width="16" height="2.4" rx="1.2" fill={SHINE} opacity=".45" />
    </>
  ),
  flask: (
    <>
      <path d="M2.5 -31H11.5V-21L19.5 -5C21 -1.5 18.5 2 15 2H-1C-4.5 2 -7 -1.5 -5.5 -5L2.5 -21Z" fill={v('glass')} stroke={v('metal')} strokeWidth="2" />
      <path d="M-3.4 -8.5H17.4L19.5 -5C21 -1.5 18.5 2 15 2H-1C-4.5 2 -7 -1.5 -5.5 -5Z" fill={v('ok')} opacity=".85" />
      <circle className="bub b1" cx="4" cy="-5" r="1.6" fill={SHINE} />
      <circle className="bub b2" cx="9" cy="-3" r="1.2" fill={SHINE} />
      <circle className="bub b3" cx="12" cy="-6" r="1.4" fill={SHINE} />
      <rect x="1" y="-34" width="12" height="4" rx="2" fill={v('metal')} />
    </>
  ),
  key: (
    <>
      <circle cx="4" cy="-25" r="6.5" fill="none" stroke={v('gold')} strokeWidth="3.6" />
      <rect x="2.2" y="-19" width="3.6" height="20" rx="1.6" fill={v('gold')} />
      <rect x="5" y="-6" width="5" height="3" rx="1" fill={v('gold')} />
      <rect x="5" y="-1.5" width="3.5" height="2.8" rx="1" fill={v('gold')} />
    </>
  ),
  gauge: (
    <>
      <circle cx="6" cy="-17" r="11.5" fill={PAPER} stroke={v('metal')} strokeWidth="2.8" />
      <path d="M-1.5 -14A8 8 0 0 1 13.5 -14" stroke={v('ok')} strokeWidth="2" fill="none" />
      <path className="needle" d="M6 -17 11 -23" stroke={v('danger')} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="6" cy="-17" r="1.8" fill={INK} />
    </>
  ),
  ruler: (
    <>
      <rect x="-2.5" y="-34" width="8" height="36" rx="1.8" fill={v('gold')} />
      <path d="M-2.5 -28H1M-2.5 -22H2.5M-2.5 -16H1M-2.5 -10H2.5M-2.5 -4H1" stroke={v('wood')} strokeWidth="1.3" />
    </>
  ),
  fuse: <path d="M9 -36 -2 -15H6L0 2 15 -21H6.5L13 -36Z" fill={v('gold')} stroke={v('gold-dark')} strokeWidth="1.6" strokeLinejoin="round" />,
  brick: (
    <>
      <rect x="-9" y="-15" width="21" height="12" rx="2" fill={v('clay')} />
      <path d="M-9 -9H12M1.5 -15V-9M-4 -9V-3M7 -9V-3" stroke={SHINE} strokeWidth="1.2" opacity=".6" />
    </>
  ),
  stopwatch: (
    <>
      <rect x="3" y="-31" width="6" height="4.5" rx="1.5" fill={v('metal')} />
      <circle cx="6" cy="-17" r="11" fill={PAPER} stroke={v('metal')} strokeWidth="2.8" />
      <path className="needle" d="M6 -17V-24.5" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="-17" r="1.6" fill={v('danger')} />
    </>
  ),
  brush: (
    <>
      <rect x="-1.8" y="-22" width="4" height="24" rx="2" transform="rotate(14)" fill={v('wood')} />
      <rect x="2" y="-30" width="6" height="7" rx="1" transform="rotate(14)" fill={v('metal')} />
      <path d="M3.4 -38C3.4 -38 10 -36 9.6 -30.5L3 -31.6Z" fill={v('brush')} />
    </>
  ),
};

export function Eyes({ state }: { state: CrewState }) {
  if (state === 'asleep') return <path d="M48.5 43Q52 46.5 55.5 43M64.5 43Q68 46.5 71.5 43" stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none" />;
  if (state === 'celebrating') return <path d="M48.5 44Q52 39 55.5 44M64.5 44Q68 39 71.5 44" stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />;
  if (state === 'thinking') {
    // Looking up and to the side, as if working something out.
    return (
      <g className="eyes">
        <ellipse cx="53.6" cy="40.2" rx="2.6" ry="3.2" fill={INK} />
        <ellipse cx="69.6" cy="40.2" rx="2.6" ry="3.2" fill={INK} />
        <circle cx="54.6" cy="38.8" r="1" fill={SHINE} />
        <circle cx="70.6" cy="38.8" r="1" fill={SHINE} />
      </g>
    );
  }
  const ry = state === 'working' ? 2.7 : state === 'waiting' ? 4 : 3.5;
  return (
    <g className="eyes">
      <ellipse cx="52" cy="42" rx="2.8" ry={ry} fill={INK} />
      <ellipse cx="68" cy="42" rx="2.8" ry={ry} fill={INK} />
      <circle cx="53.1" cy="40.4" r="1.1" fill={SHINE} />
      <circle cx="69.1" cy="40.4" r="1.1" fill={SHINE} />
    </g>
  );
}

export function Mouth({ state }: { state: CrewState }) {
  if (state === 'celebrating' || state === 'waiting') {
    return (
      <>
        <path d="M55 49.5Q60 57.5 65 49.5Z" fill={INK} />
        <path d="M57.3 53.4Q60 55.6 62.7 53.4" stroke={v('tongue')} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (state === 'working') return <path d="M56.5 51.2Q60 52.6 63.5 51.2" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />;
  if (state === 'asleep') return <ellipse cx="60" cy="51.5" rx="2" ry="2.4" fill={INK} opacity=".8" />;
  if (state === 'thinking') return <path d="M56.5 52Q60.5 50.4 64.5 51.4" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />;
  return <path d="M55.5 50Q60 54.2 64.5 50" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />;
}

export function Effects({ state, motion }: { state: CrewState; motion: Motion }) {
  if (state === 'working') {
    return (
      <>
        {motion === 'strike' && (
          <g className="sparks">
            <path className="spark s1" d="M101 86l1.4 3.2 3.2 1.4-3.2 1.4-1.4 3.2-1.4-3.2-3.2-1.4 3.2-1.4z" fill={v('spark')} />
            <path className="spark s2" d="M108 94l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill={v('spark')} />
            <path className="spark s3" d="M96 96l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill={SHINE} />
          </g>
        )}
        <path className="sweat" d="M83 26c2 3.2 3 5 3 6.4a3 3 0 0 1-6 0c0-1.4 1-3.2 3-6.4z" fill={v('glass')} stroke={v('glass-line')} strokeWidth=".8" />
      </>
    );
  }
  if (state === 'thinking') {
    return (
      <g className="think" fill={PAPER} stroke={v('line')} strokeWidth="1.2">
        <circle className="t1" cx="84" cy="25" r="2.2" />
        <circle className="t2" cx="90.5" cy="16.5" r="3.4" />
        <circle className="t3" cx="99.5" cy="7" r="5" />
      </g>
    );
  }
  if (state === 'asleep') {
    return (
      <g className="zzz" fill={v('zzz')} aria-hidden="true">
        <text className="z1" x="80" y="26" fontSize="10">z</text>
        <text className="z2" x="87" y="17" fontSize="13">z</text>
        <text className="z3" x="95" y="7" fontSize="16">Z</text>
      </g>
    );
  }
  if (state === 'celebrating') {
    return (
      <g className="confetti">
        <rect className="c1" x="24" y="10" width="5" height="3" rx="1" fill={v('c-amber')} />
        <rect className="c2" x="40" y="4" width="4" height="4" rx="1" fill={v('c-plum')} />
        <rect className="c3" x="78" y="6" width="5" height="3" rx="1" fill={v('c-blueprint')} />
        <rect className="c4" x="92" y="12" width="4" height="4" rx="1" fill={v('c-moss')} />
        <rect className="c5" x="58" y="0" width="5" height="3" rx="1" fill={v('c-clay')} />
        <rect className="c6" x="16" y="22" width="4" height="4" rx="1" fill={v('c-teal')} />
      </g>
    );
  }
  return null;
}
