// Whether this browser can draw the 3D floor: a WebGL context can be made (WebGL 2, else 1). Asked
// once per page. Without it the floor shows its 2D cards instead, with the same words.
let known: boolean | null = null;

export function hasWebGL(): boolean {
  if (known !== null) return known;
  try {
    const c = document.createElement('canvas');
    known = Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    known = false;
  }
  return known;
}

/** Tests: forget the answer (or set one). */
export function setWebGLForTests(value: boolean | null) { known = value; }
