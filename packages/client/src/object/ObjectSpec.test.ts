import { describe, expect, it } from 'vitest';
import { OBJECT_SPECS, specFor, halfExtents } from './ObjectSpec.js';
import type { ObjectDef } from '@chambler/shared';

function def(kind: ObjectDef['kind']): ObjectDef {
  return {
    id: 'x',
    kind,
    assetRef: '',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
  };
}

describe('ObjectSpec mapping', () => {
  it('die is box with 6 faces dimension', () => {
    const s = specFor(def('die'));
    expect(s.shape).toBe('box');
    expect(s.size).toEqual({ x: 0.6, y: 0.6, z: 0.6 });
    expect(s.mass).toBeGreaterThan(0);
  });
  it('pawn is a box body (visual is a lathe pawn)', () => {
    const s = specFor(def('pawn'));
    expect(s.shape).toBe('box');
    expect(s.size.y).toBeGreaterThan(s.size.x);
  });
  it('card is thin box', () => {
    const s = specFor(def('card'));
    expect(s.shape).toBe('box');
    expect(s.size.y).toBeLessThan(0.1);
  });
  it('board mass zero (static-ish)', () => {
    const s = specFor(def('board'));
    expect(s.mass).toBe(0);
  });
  it('halfExtents halves size', () => {
    const s = specFor(def('die'));
    const he = halfExtents(s);
    expect(he.x).toBe(s.size.x / 2);
  });
  it('all kinds have spec', () => {
    const kinds: ObjectDef['kind'][] = ['die', 'pawn', 'token', 'tile', 'board', 'card', 'deck', 'custom'];
    for (const k of kinds) {
      expect(OBJECT_SPECS[k]).toBeDefined();
    }
  });
});
