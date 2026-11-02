// <CrewMember type state size label animated />: one station crew member as inline SVG (packet SB):
// a suit in the member's colours, a helmet whose visor stands in for a face (they stay faceless),
// the helmet's own fittings (the pack's hat id), a shoulder patch in the colour of the stop they
// work in, gloves, boots and a tool. First drawn from dashboard/public/crew.js's rig.
//
//   type      the agent type ('feature-tester'); an unknown one gets a plain look
//   state     working · waiting · idle · asleep · celebrating · walking (the mood: pose and effects)
//   size      width and height in px (Subtle callers keep it small)
//   label     the accessible name (default: "<Name>, <mood>", e.g. "Builder, working"); '' draws it
//             as decoration (then the caller shows the name in text)
//   animated  move (default: Full mode, from usePlay). Otherwise, or with reduced motion asked
//             for, it holds a still pose that still shows the mood.
//   silhouette  draw only their outline in --crew-silhouette (the Crew-dex's "not met yet"); never moves
//
// On a few dates they wear the season's hat instead of their own (Halloween, Christmas, New Year),
// and nightcaps from midnight to 5am (play/eggs.ts): seeing a seasonal one is a secret found.
//
// With Play mode Off it draws nothing (returns null), so callers needn't check. Outside a
// WorkshopContext (tests, isolated previews) it always draws.
//
// Colours come from --crew-* tokens (theme/tokens.ts, restyled per theme); animations live in
// play/play.css and only run on .crew.is-animated.
import { memo, useEffect } from 'react';
import { crewInfo, MOTION, type CrewState } from './crew';
import { Effects, EXTRA_HATS, HATS, TOOLS } from './crewParts';
import { crewNow, extraHat } from './eggs';
import { usePlayIfAny, usePrefersReducedMotion } from './usePlay';
import { useFindSecret } from './useSecret';

export interface CrewMemberProps {
  type: string;
  state?: CrewState;
  size?: number;
  label?: string;
  animated?: boolean;
  silhouette?: boolean;
  className?: string;
}

const C = (name: string) => `var(--crew-${name})`;

/** The accessible name a crew member gets by default: "Builder, working". */
export const crewLabel = (type: string, state: CrewState) => `${crewInfo(type).name}, ${state}`;

// Memoized: its props are plain values, and a thread draws many of them.
export const CrewMember = memo(function CrewMember({ type, state = 'idle', size = 48, label, animated, silhouette = false, className }: CrewMemberProps) {
  const reduced = usePrefersReducedMotion();
  const play = usePlayIfAny();
  const find = useFindSecret();
  // A silhouette keeps its own hat: it isn't anyone yet.
  const extra = silhouette ? null : extraHat(crewNow());
  const seasonal = extra !== null && extra !== 'nightcap';
  useEffect(() => { if (seasonal) void find('seasonal-hats'); }, [seasonal, find]);
  if (play && !play.on) return null;
  const member = crewInfo(type);
  const key = member.number ? member.type : 'unknown';
  const motion = MOTION[member.tool];
  const moving = !silhouette && (animated ?? play?.animated ?? false) && !reduced;
  const name = label ?? crewLabel(type, state);
  const decorative = name === '';
  const classes = ['crew', `crew-${key}`, `is-${state}`, `m-${motion}`, moving ? 'is-animated' : 'is-still', silhouette && 'is-silhouette', className].filter(Boolean).join(' ');
  return (
    <svg
      className={classes}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      data-crew={key}
      data-state={state}
      {...(decorative ? { 'aria-hidden': true, focusable: 'false' } : { role: 'img', 'aria-label': name, 'data-tip': name })}
    >
      <ellipse className="shadow" cx="60" cy="110" rx="25" ry="4.6" fill={C('shadow')} />
      <g className="rig">
        <g className="feet">
          <ellipse className="foot foot-l" cx="51" cy="105.5" rx="7.4" ry="4.2" fill={C('feet')} />
          <ellipse className="foot foot-r" cx="69" cy="105.5" rx="7.4" ry="4.2" fill={C('feet')} />
        </g>
        <g className="arm arm-l">
          <path d="M45 64 38 86" stroke={C('paint-arm')} strokeWidth="9.5" strokeLinecap="round" />
          <circle cx="38" cy="87.5" r="5.6" fill={C('feet')} />
        </g>
        {/* The life-support pack, just showing past the shoulders. */}
        <rect x="42" y="57" width="36" height="20" rx="6" fill={C('metal')} />
        <path className="torso" d="M44 66C44 60 49 58 54 58H66C71 58 76 60 76 66L79 96C79.6 101 76 104 71 104H49C44 104 40.4 101 41 96Z" fill={C('paint')} />
        <path d="M42.2 86H77.8L78.3 91.2H41.7Z" fill={C('paint-shade')} opacity=".75" />
        <ellipse cx="51.5" cy="72" rx="4.4" ry="7.4" fill={C('shine')} opacity=".2" />
        {/* A small chest panel, and the patch on the shoulder in the stop's colour. */}
        <rect x="55" y="70" width="11" height="8" rx="2" fill={C('metal')} />
        <circle cx="58" cy="74" r="1.3" fill={C('shine')} />
        <circle cx="63" cy="74" r="1.3" fill={C('patch')} />
        <circle className="patch" cx="71.5" cy="66" r="4.6" fill={C('patch')} stroke={C('shine')} strokeWidth="1" />
        <ellipse cx="60" cy="60.5" rx="13" ry="3.6" fill={C('metal')} />
        <g className="head">
          <circle cx="60" cy="40" r="22.5" fill={C('paper')} stroke={C('line')} strokeWidth="1.2" />
          <ellipse cx="50.5" cy="27.5" rx="7" ry="4.4" fill={C('shine')} opacity=".4" />
          <rect x="34.6" y="35" width="5" height="11" rx="2.5" fill={C('metal')} />
          <rect x="80.4" y="35" width="5" height="11" rx="2.5" fill={C('metal')} />
          {/* The visor: no face behind it, only a glint. */}
          <path className="visor" d="M43.5 37C43.5 31 50 29 60 29S76.5 31 76.5 37V43.5C76.5 50 70 53.5 60 53.5S43.5 50 43.5 43.5Z" fill={C('ink')} stroke={C('paint')} strokeWidth="1.6" />
          <path className="visor-glint" d="M48 35Q52.5 31.8 58.5 31.6" stroke={C('glass')} strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <circle cx="70.5" cy="47" r="1.4" fill={C('glass')} opacity=".8" />
          <g className={extra ? `hat hat-${extra}` : 'hat'}>{extra ? EXTRA_HATS[extra] : HATS[member.hat]}</g>
        </g>
        <g className="arm arm-r">
          <path d="M75 64 83 86" stroke={C('paint-arm')} strokeWidth="9.5" strokeLinecap="round" />
          <g className="tool" transform="translate(84.5 87)"><g className="grip">{TOOLS[member.tool]}</g></g>
          <circle cx="84" cy="87.5" r="5.6" fill={C('feet')} />
        </g>
      </g>
      <g className="fx"><Effects state={state} motion={motion} /></g>
    </svg>
  );
});
