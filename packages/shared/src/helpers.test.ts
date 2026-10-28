import { describe, expect, it } from 'vitest';
import { cloneTransform, generateId, IDENTITY_TRANSFORM } from './helpers.js';
import { TRANSFORM_RATE_HZ } from './protocol.js';
import type { Transform } from './types.js';

describe('generateId', () => {
  it('creates an id with the given prefix', () => {
    const id = generateId('die');
    expect(id.startsWith('die_')).toBe(true);
    expect(id.length).toBeGreaterThan('die'.length + 2);
  });

  it('generates unique ids', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateId('x')));
    expect(seen.size).toBe(200);
  });
});

describe('IDENTITY_TRANSFORM', () => {
  it('is a unit transform', () => {
    expect(IDENTITY_TRANSFORM.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(IDENTITY_TRANSFORM.rotation).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    expect(IDENTITY_TRANSFORM.scale).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('protocol constant', () => {
  it('transform channel runs at 20 Hz', () => {
    expect(TRANSFORM_RATE_HZ).toBe(20);
  });
});

describe('cloneTransform', () => {
  const source: Transform = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { w: 0.7071, x: 0, y: 0.7071, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
  };

  it('deep-copies every vector/quat member', () => {
    const copy = cloneTransform(source);
    expect(copy).toEqual(source);
    expect(copy.position).not.toBe(source.position);
    expect(copy.rotation).not.toBe(source.rotation);
    expect(copy.scale).not.toBe(source.scale);
  });

  it('mutations on the copy do not leak into the source', () => {
    const copy = cloneTransform(source);
    copy.position.x = 99;
    copy.rotation.w = 0;
    expect(source.position.x).toBe(1);
    expect(source.rotation.w).toBe(0.7071);
  });
});
