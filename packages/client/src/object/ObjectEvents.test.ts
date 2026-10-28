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

describe('ObjectEventEmitter per-object throttle', () => {
  const mkT = () => cloneTransform({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });

  it('single object 20Hz', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    let count = 0;
    for (let i = 0; i < 100; i++) if (e.emitTransformUpdate('a', t, undefined, i * 10)) count++;
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(21);
  });

  it('three objects parallel each 20Hz', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    e.on('transformUpdate', (p) => { counts[p.id]!++; });
    for (let i = 0; i < 100; i++) {
      e.emitTransformUpdate('a', t, undefined, i * 10);
      e.emitTransformUpdate('b', t, undefined, i * 10);
      e.emitTransformUpdate('c', t, undefined, i * 10);
    }
    for (const k of ['a', 'b', 'c']) {
      expect(counts[k]).toBeGreaterThanOrEqual(10);
      expect(counts[k]).toBeLessThanOrEqual(21);
    }
  });

  it('ten objects parallel', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    const counts = new Map<string, number>();
    for (let o = 0; o < 10; o++) counts.set(`o${o}`, 0);
    e.on('transformUpdate', (p) => counts.set(p.id, (counts.get(p.id) ?? 0) + 1));
    for (let i = 0; i < 50; i++) {
      for (let o = 0; o < 10; o++) e.emitTransformUpdate(`o${o}`, t, undefined, i * 10);
    }
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(5);
      expect(c).toBeLessThanOrEqual(12);
    }
  });

  it('no drift across repeated runs', () => {
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const e = new ObjectEventEmitter();
      const t = mkT();
      let count = 0;
      for (let i = 0; i < 100; i++) if (e.emitTransformUpdate('a', t, undefined, i * 10)) count++;
      runs.push(count);
    }
    expect(new Set(runs).size).toBe(1);
  });

  it('cleans up throttle on remove', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    e.emitTransformUpdate('a', t, undefined, 0);
    expect(e.lastTransformEmit.has('a')).toBe(true);
    e.remove('a');
    expect(e.lastTransformEmit.has('a')).toBe(false);
    // first emit after cleanup succeeds even at same timestamp
    expect(e.emitTransformUpdate('a', t, undefined, 0)).toBe(true);
  });

  it('cleans up throttle on forget', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    e.emitTransformUpdate('a', t, undefined, 0);
    e.forget('a');
    expect(e.emitTransformUpdate('a', t, undefined, 0)).toBe(true);
  });

  it('resilient to backward clock', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    expect(e.emitTransformUpdate('a', t, undefined, 100)).toBe(true);
    expect(() => e.emitTransformUpdate('a', t, undefined, 50)).not.toThrow();
    expect(e.emitTransformUpdate('a', t, undefined, 50)).toBe(false);
    // forward again works
    expect(e.emitTransformUpdate('a', t, undefined, 200)).toBe(true);
  });

  it('defers instead of dropping on budget overflow', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    e.emitTransformUpdate('a', t, undefined, 0); // emitted
    expect(e.emitTransformUpdate('a', t, undefined, 10)).toBe(false); // deferred
    expect(e.pendingTransforms.has('a')).toBe(true);
    // deferred frame is emitted when due via flush
    const flushed = e.flush(50);
    expect(flushed).toBe(1);
    expect(e.pendingTransforms.has('a')).toBe(false);
  });

  it('last frame wins for same object', () => {
    const e = new ObjectEventEmitter();
    const received: number[] = [];
    e.on('transformUpdate', (p) => received.push((p.transform.position as { x: number }).x));
    const t1 = cloneTransform({ position: { x: 1, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    const t2 = cloneTransform({ position: { x: 2, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    e.emitTransformUpdate('a', t1, undefined, 0);
    e.emitTransformUpdate('a', t2, undefined, 10); // deferred, replaces pending
    e.flush(50);
    // the emitted deferred frame should be the latest (x=2), not x=1
    expect(received).toContain(2);
  });

  it('resetThrottle clears all', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    e.emitTransformUpdate('a', t, undefined, 0);
    e.emitTransformUpdate('b', t, undefined, 0);
    e.resetThrottle();
    expect(e.lastTransformEmit.size).toBe(0);
    expect(e.emitTransformUpdate('a', t, undefined, 0)).toBe(true);
  });

  it('resetThrottle with id clears one', () => {
    const e = new ObjectEventEmitter();
    const t = mkT();
    e.emitTransformUpdate('a', t, undefined, 0);
    e.emitTransformUpdate('b', t, undefined, 0);
    e.resetThrottle('a');
    expect(e.lastTransformEmit.has('a')).toBe(false);
    expect(e.lastTransformEmit.has('b')).toBe(true);
  });
});
