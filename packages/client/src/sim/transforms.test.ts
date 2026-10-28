import { describe, expect, it } from 'vitest';
import {
  rapierToTransform,
  lerpTransform,
  clamp,
} from './transforms.js';
import type { Transform } from '@chambler/shared';

describe('transforms', () => {
  it('converts rapier (x,y,z,w) rotation to shared (w,x,y,z)', () => {
    const t = rapierToTransform({ x: 1, y: 2, z: 3 }, { x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
    expect(t.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(t.rotation).toEqual({ w: 0.9, x: 0.1, y: 0.2, z: 0.3 });
  });

  it('lerpTransform interpolates position', () => {
    const a: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const b: Transform = {
      position: { x: 10, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const r = lerpTransform(a, b, 0.5);
    expect(r.position.x).toBeCloseTo(5, 5);
  });

  it('clamp works', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});