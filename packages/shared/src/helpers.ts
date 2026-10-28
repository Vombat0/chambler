import type { Transform } from './types.js';

const IDENTITY: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/** Frozen read-only identity; always `cloneTransform` before mutating. */
export const IDENTITY_TRANSFORM: Readonly<Transform> = IDENTITY;

/** Deep-copies a transform so object identity never leaks between clients. */
export function cloneTransform(t: Transform): Transform {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}

/** Generates a `{prefix}_{uuid}` id. Uses standard WebCrypto (Node >= 19 and all browsers). */
export function generateId(prefix: string): string {
  const fallback = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallback;
  return `${prefix}_${uuid}`;
}
