import { describe, expect, it } from 'vitest';
import { ObjectEventEmitter } from './ObjectEvents.js';
import { cloneTransform } from '@chambler/shared';

describe('ObjectEventEmitter throttle', () => {
  it('first emit succeeds', () => {
    const e = new ObjectEventEmitter();
    const t = cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    expect(e.emitTransformUpdate('a', t, undefined, 0)).toBe(true);
  });
  it('second within 50ms dropped', () => {
    const e = new ObjectEventEmitter();
    const t = cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    e.emitTransformUpdate('a', t, undefined, 0);
    expect(e.emitTransformUpdate('a', t, undefined, 10)).toBe(false);
  });
  it('after 50ms succeeds', () => {
    const e = new ObjectEventEmitter();
    const t = cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    e.emitTransformUpdate('a', t, undefined, 0);
    expect(e.emitTransformUpdate('a', t, undefined, 50)).toBe(true);
  });
  it('counts transforms at 20Hz max', () => {
    const e = new ObjectEventEmitter();
    const t = cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    let count = 0;
    for (let i = 0; i < 100; i++) {
      if (e.emitTransformUpdate('a', t, undefined, i * 10)) count++;
    }
    expect(count).toBeLessThanOrEqual(21);
    expect(count).toBeGreaterThanOrEqual(10);
  });
  it('emits event to listener', () => {
    const e = new ObjectEventEmitter();
    const t = cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    let got = false;
    e.on('transformUpdate', () => { got = true; });
    e.emitTransformUpdate('a', t, undefined, 0);
    expect(got).toBe(true);
  });
});
