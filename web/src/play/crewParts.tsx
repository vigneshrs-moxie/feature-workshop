// The station crew's parts as SVG elements (packet SB; first ported from dashboard/public/crew.js):
// seven sets of helmet fittings (and four hats for special days and nights, worn over the helmet),
// fourteen tools (drawn with the hand at 0,0) and the effects per mood. No faces: the visor
// stands in for one.
// Every colour is a --crew-* custom property (theme/tokens.ts CREW_TOKENS; themes restyle them),
// so nothing here is a fixed colour. Static shapes only: nothing takes text or markup from outside.
import type { ReactElement } from 'react';
import type { CrewState, HatId, Motion, ToolId } from './crew';
import type { ExtraHat } from './eggs';

const v = (name: string) => `var(--crew-${name})`;
const HAT = v('hat');
const HAT_SHADE = v('hat-shade');
const SHINE = v('shine');
const PAPER = v('paper');
const INK = v('ink');

/**
 * The helmet's fittings, one set per member (the pack's `hat` ids, kept so each character stays
 * itself): drawn on the helmet's crown, never over the visor.
 */
export const HATS: Record<HatId, ReactElement> = {
  // The Foreman: a crest down the crown and a headlamp.
  hardhat: (
    <>
      <rect x="56.5" y="15.4" width="7" height="13.5" rx="3.5" fill={HAT} />
      <circle cx="60" cy="24.6" r="3.2" fill={SHINE} stroke={HAT_SHADE} strokeWidth="1.2" />
    </>
  ),
  // A long antenna on the left, tipped with a bead.
  beret: (
    <>
      <path d="M45.5 21 38.5 6.5" stroke={HAT_SHADE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="38.2" cy="6.2" r="3.4" fill={HAT} />
      <rect x="43" y="19" width="6" height="4" rx="2" transform="rotate(-25 46 21)" fill={HAT} />
    </>
  ),
  // Two short feelers, one each side of the crown.
  deerstalker: (
    <>
      <path d="M48 19.5 43.5 9M72 19.5 76.5 9" stroke={HAT_SHADE} strokeWidth="2" strokeLinecap="round" />
      <circle cx="43.3" cy="8.4" r="2.8" fill={HAT} />
      <circle cx="76.7" cy="8.4" r="2.8" fill={HAT} />
    </>
  ),
  // A sun shade over the top of the visor.
  cap: (
    <>
      <path d="M41 30.5Q60 22.5 79 30.5L82.5 33.5Q60 26 37.5 33.5Z" fill={HAT} />
      <path d="M47 27.4Q60 23.6 73 27.4" stroke={SHINE} strokeWidth="1.3" opacity=".4" fill="none" strokeLinecap="round" />
    </>
  ),
  // A band round the helmet with a hinge each side, for a welding shield.
  bandana: (
    <>
      <path d="M38.6 31.5C50 27 70 27 81.4 31.5L81.8 35.5C70 31 50 31 38.2 35.5Z" fill={HAT} />
      <circle cx="39.5" cy="34" r="2.6" fill={HAT_SHADE} />
      <circle cx="80.5" cy="34" r="2.6" fill={HAT_SHADE} />
    </>
  ),
  // A scanner eyepiece clipped to the right of the helmet.
  goggles: (
    <>
      <rect x="73" y="23.5" width="13" height="10" rx="3.5" fill={HAT_SHADE} />
      <circle cx="80.4" cy="28.5" r="3.4" fill={v('glass')} stroke={HAT} strokeWidth="1.8" />
      <path d="M78.6 27Q79.6 25.9 81 25.9" stroke={SHINE} strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </>
  ),
  // The reviewers' tinted shade, flipped up on the crown.
  visor: (
    <>
      <path d="M40.5 29.5Q60 20 79.5 29.5L78.5 25Q60 16.5 41.5 25Z" fill={HAT} opacity=".94" />
      <path d="M46 25Q60 19.5 74 25" stroke={SHINE} strokeWidth="1.3" opacity=".4" fill="none" />
      <circle cx="41" cy="28" r="2" fill={HAT_SHADE} />
      <circle cx="79" cy="28" r="2" fill={HAT_SHADE} />
    </>
  ),
};

/** The hats worn instead of their own on a few dates, and nightcaps after midnight (play/eggs.ts extraHat). */
export const EXTRA_HATS: Record<ExtraHat, ReactElement> = {
  witch: (
    <>
      <ellipse cx="60" cy="31" rx="31" ry="6" fill={v('feet')} />
      <path d="M44 30 58 2Q61 -1 63 3L76 30Z" fill={v('feet')} />
      <path d="M45.5 26.5H74.5L76 30H44Z" fill={v('c-plum')} />
      <rect x="57" y="25.6" width="6" height="5.4" rx="1" fill={v('gold')} />
    </>
  ),
  santa: (
    <>
      <path d="M40 31C40 16 52 9 64 11Q82 14 88 32L82 33Q76 22 66 20 50 19 50 31Z" fill={v('danger')} />
      <rect x="37" y="28" width="46" height="8" rx="4" fill={PAPER} />
      <circle cx="87" cy="34" r="5.2" fill={PAPER} />
    </>
  ),
  party: (
    <>
      <path d="M47 32 60 3 73 32Z" fill={v('c-teal')} />
      <path d="M51.5 22 66 18.5M55 14 64.5 11.5M49 28 70 23.5" stroke={v('spark')} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="60" cy="3.5" r="4" fill={v('gold')} />
      <path d="M47 32Q60 35 73 32" stroke={HAT_SHADE} strokeWidth="1.4" fill="none" />
    </>
  ),
  nightcap: (
    <>
      <path d="M38.5 33C38 18 50 12 62 14Q78 17 92 42L86 44Q76 26 66 25 52 25 50 33Z" fill={v('zzz')} />
      <rect x="36" y="29.5" width="48" height="7" rx="3.5" fill={PAPER} opacity=".92" />
      <circle cx="90" cy="45" r="4.6" fill={PAPER} />
    </>
  ),
};

/** A hex ring round (cx, cy) of radius r, for the inspection lens. */
const hexPoints = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i + Math.PI / 6;
  return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

export const TOOLS: Record<ToolId, ReactElement> = {
  // The Foreman's holo-slate: a thin frame with a lit screen and the job's lines on it.
  slate: (
    <>
      <rect x="-4" y="-28" width="21" height="27" rx="3.4" fill={INK} />
      <rect x="-1.4" y="-25.4" width="15.8" height="21.8" rx="1.8" fill={v('glass')} />
      <path d="M1.5 -21H11.5M1.5 -16.5H9M1.5 -12H11.5" stroke={SHINE} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6.5" cy="-6.6" r="1.3" fill={SHINE} />
    </>
  ),
  // The Head inspector's inspection lens: a hex frame on a short grip.
  lens: (
    <>
      <path d="M1 0 4 -12" stroke={v('metal')} strokeWidth="4.4" strokeLinecap="round" />
      <polygon points={hexPoints(8.5, -22, 10)} fill={v('glass')} stroke={v('metal')} strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M3.6 -25.6Q5.8 -29 9.8 -29.4" stroke={SHINE} strokeWidth="2" strokeLinecap="round" fill="none" />
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
  // The Planner's holo-tablet, showing a blueprint.
  tablet: (
    <>
      <rect x="-7" y="-25" width="27" height="19" rx="2.8" fill={INK} />
      <rect x="-4.6" y="-22.6" width="22.2" height="14.2" rx="1.4" fill={v('blueprint')} />
      <path d="M-4.6 -18H17.6M-4.6 -13H17.6M2 -22.6V-8.4M10 -22.6V-8.4" stroke={SHINE} strokeWidth=".7" opacity=".45" />
      <path d="M-1 -20H8V-11H14" stroke={SHINE} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
    </>
  ),
  // The Builder's welder: a grip, a head and a nozzle with a hot tip.
  welder: (
    <>
      <rect x="-2.6" y="-21" width="5.2" height="22" rx="2.6" fill={v('metal')} />
      <rect x="-6.5" y="-31" width="15" height="11" rx="3.4" fill={INK} />
      <path d="M8 -28.2 16.5 -30V-22.5L8 -23.6Z" fill={v('metal')} />
      <circle className="tip" cx="17.6" cy="-26.2" r="2.3" fill={v('spark')} />
      <rect x="-4.2" y="-29" width="9" height="2.2" rx="1.1" fill={SHINE} opacity=".35" />
    </>
  ),
  // The Tester's scanner: a grip, a body with a small screen and a dish that reads.
  scanner: (
    <>
      <rect x="-2.4" y="-17" width="4.8" height="18" rx="2.4" fill={INK} />
      <rect x="-7.5" y="-30" width="19" height="14" rx="4" fill={v('metal')} />
      <rect x="-4.5" y="-27" width="9.5" height="6.5" rx="1.2" fill={v('ok')} opacity=".9" />
      <ellipse cx="13.6" cy="-23" rx="3.2" ry="6.4" fill={v('glass')} stroke={v('glass-line')} strokeWidth="1.2" />
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
