// The one door to the 3D scene: import() here, and nowhere else, so three.js stays in its own chunk
// that loads the first time the floor shows in Play full (floor3d.test.ts checks no other file
// imports the scene or three.js).
export type SceneModule = typeof import('./scene/index');

let pending: Promise<SceneModule> | null = null;

export function loadScene(): Promise<SceneModule> {
  pending ??= import('./scene/index').catch((err) => { pending = null; throw err; });
  return pending;
}
