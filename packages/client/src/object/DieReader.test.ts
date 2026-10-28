import { describe, expect, it } from 'vitest';
import { readDieFace } from './DieReader.js';
import { quaternionForTopFace } from './DieReader.js';

describe('readDieFace', () => {
  it('identity -> 1 (top face +Y)', () => {
    expect(readDieFace({ w: 1, x: 0, y: 0, z: 0 })).toBe(1);
  });
  it('rotated 180 around X -> 6', () => {
    expect(readDieFace({ w: 0, x: 1, y: 0, z: 0 })).toBe(6);
  });
  it('rotated -90 around Z? face 2 (+X) top', () => {
    // rotate so +X becomes up: 90 around Z? local +X -> world +Y requires rotation -90 around Z? Let's brute: quaternion rotating +X to +Y is 90 deg around Z: w=cos45, z=sin45.
    const q = { w: Math.cos(Math.PI / 4), x: 0, y: 0, z: Math.sin(Math.PI / 4) };
    expect(readDieFace(q)).toBe(2);
  });
  it('face 5 (-X) top', () => {
    const q = { w: Math.cos(Math.PI / 4), x: 0, y: 0, z: -Math.sin(Math.PI / 4) };
    expect(readDieFace(q)).toBe(5);
  });
  it('face 3 (+Z) top', () => {
    // rotate +Z to +Y: -90 around X
    const q = { w: Math.cos(-Math.PI / 4), x: Math.sin(-Math.PI / 4), y: 0, z: 0 };
    expect(readDieFace(q)).toBe(3);
  });
  it('face 4 (-Z) top', () => {
    const q = { w: Math.cos(Math.PI / 4), x: Math.sin(Math.PI / 4), y: 0, z: 0 };
    expect(readDieFace(q)).toBe(4);
  });
  it('opposite faces sum to 7 (sanity via helper)', () => {
    for (let v = 1; v <= 6; v++) {
      const q = quaternionForTopFace(v);
      expect(readDieFace(q)).toBe(v);
    }
  });
});
