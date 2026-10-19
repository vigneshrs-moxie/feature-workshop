// The easter eggs' short scenes (play/eggs.ts showScene), drawn with the play toasts: bottom-right,
// over the Preview pane, never over the composer, a gate card or a permission card. Each is a crew
// member (or a few) doing something for under 1.5 s, once (the crew hold a still pose; the scene's
// own keyframes move them), holding still under reduced motion, with its
// words read out politely. It goes by itself after a few seconds, or with Dismiss.
import { useEffect } from 'react';
import { CrewMember } from './CrewMember';
import { endScene, SCENE_MS, useScenes, type Scene, type SceneKind } from './eggs';
import { CREW_SIZE } from './crewSizes';

const CAST: Record<SceneKind, { types: string[]; label: string }> = {
  hammertime: { types: ['feature-implementer'], label: 'Hammer time' },
  sandwich: { types: ['conductor'], label: 'Sandwich' },
  'git-blame': { types: ['feature-implementer', 'feature-tester', 'feature-reviewer', 'feature-investigator'], label: 'git blame' },
  foreman: { types: ['conductor'], label: 'The Foreman says' },
  konami: { types: ['feature-tester'], label: 'Secret theme' },
};

function SceneCard({ scene }: { scene: Scene }) {
  const cast = CAST[scene.kind];
  useEffect(() => {
    const t = setTimeout(() => endScene(scene.key), SCENE_MS);
    return () => clearTimeout(t);
  }, [scene.key]);
  return (
    <div className={`play-toast play-scene scene-${scene.kind}`} data-scene={scene.kind}>
      <span className="scene-cast" aria-hidden="true">
        {cast.types.map((t, i) => (
          <span key={t} className={`scene-actor actor-${i}`}>
            <CrewMember type={t} state={scene.kind === 'git-blame' ? 'waiting' : 'celebrating'} size={scene.kind === 'git-blame' ? CREW_SIZE.sceneGroup : CREW_SIZE.scene} label="" animated={false} />
          </span>
        ))}
      </span>
      <div className="play-toast-body">
        <p className="play-toast-label">{cast.label}</p>
        <p className="play-toast-line scene-line">{scene.line}</p>
      </div>
      <button type="button" className="btn btn-quiet play-toast-close" aria-label="Dismiss" title="Hide this now. It also goes by itself in a moment." onClick={() => endScene(scene.key)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/** Every scene playing now (the caller draws this only with Play mode on). */
export function Scenes() {
  const scenes = useScenes();
  return <>{scenes.map((s) => <SceneCard key={s.key} scene={s} />)}</>;
}
