// <CrewMember type state size label animated />: one workshop crew member as inline SVG, the rig
// from dashboard/public/crew.js (body, head, arms, feet, a hat and a tool) in React elements.
//
//   type      the agent type ('feature-tester'); an unknown one gets a plain look
//   state     working · waiting · idle · asleep · celebrating · walking (the mood: eyes, mouth, pose)
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
import { Effects, EXTRA_HATS, Eyes, HATS, Mouth, TOOLS } from './crewParts';
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
      {...(decorative ? { 'aria-hidden': true, focusable: 'false' } : { role: 'img', 'aria-label': name })}
    >
      {!decorative && <title>{name}</title>}
      <ellipse className="shadow" cx="60" cy="110" rx="25" ry="4.6" fill={C('shadow')} />
      <g className="rig">
        <g className="feet">
          <ellipse className="foot foot-l" cx="51" cy="105.5" rx="7.4" ry="4.2" fill={C('feet')} />
          <ellipse className="foot foot-r" cx="69" cy="105.5" rx="7.4" ry="4.2" fill={C('feet')} />
        </g>
        <g className="arm arm-l">
          <path d="M45 64 38 86" stroke={C('paint-arm')} strokeWidth="9.5" strokeLinecap="round" />
          <circle cx="38" cy="87.5" r="5.4" fill={C('skin')} stroke={C('skin-shade')} strokeWidth="1" />
        </g>
        <path className="torso" d="M44 66C44 60 49 58 54 58H66C71 58 76 60 76 66L79 96C79.6 101 76 104 71 104H49C44 104 40.4 101 41 96Z" fill={C('paint')} />
        <path d="M42.2 86H77.8L78.3 91.2H41.7Z" fill={C('paint-shade')} opacity=".75" />
        <ellipse cx="51.5" cy="70" rx="4.6" ry="8" fill={C('shine')} opacity=".2" />
        <g className="head">
          <circle cx="60" cy="40" r="21.5" fill={C('skin')} stroke={C('skin-shade')} strokeWidth="1.2" />
          <ellipse cx="51.5" cy="30.5" rx="7.5" ry="5" fill={C('shine')} opacity=".32" />
          <ellipse cx="46.8" cy="47.5" rx="4.3" ry="2.6" fill={C('blush')} opacity=".75" />
          <ellipse cx="73.2" cy="47.5" rx="4.3" ry="2.6" fill={C('blush')} opacity=".75" />
          <Eyes state={state} />
          <Mouth state={state} />
          <g className={extra ? `hat hat-${extra}` : 'hat'}>{extra ? EXTRA_HATS[extra] : HATS[member.hat]}</g>
        </g>
        <g className="arm arm-r">
          <path d="M75 64 83 86" stroke={C('paint-arm')} strokeWidth="9.5" strokeLinecap="round" />
          <g className="tool" transform="translate(84.5 87)"><g className="grip">{TOOLS[member.tool]}</g></g>
          <circle cx="84" cy="87.5" r="5.4" fill={C('skin')} stroke={C('skin-shade')} strokeWidth="1" />
        </g>
      </g>
      <g className="fx"><Effects state={state} motion={motion} /></g>
    </svg>
  );
});
