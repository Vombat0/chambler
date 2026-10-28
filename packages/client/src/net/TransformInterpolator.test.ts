import { describe, expect, it } from 'vitest';
import { TransformInterpolator } from './TransformInterpolator.js';

describe('TransformInterpolator', () => {
  it('returns null when empty', () => {
    const ip = new TransformInterpolator();
    expect(ip.sample('a', 1000)).toBeNull();
  });
  it('snaps to earliest when target before buffer', () => {
    const ip = new TransformInterpolator({ delayMs: 0 });
    ip.push('a', { seq: 1, t: 100, pos: { x: 1, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    const t = ip.sample('a', 50);
    expect(t?.position.x).toBe(1);
  });
  it('interpolates between frames', () => {
    const ip = new TransformInterpolator({ delayMs: 0 });
    ip.push('a', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    ip.push('a', { seq: 2, t: 100, pos: { x: 10, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    const t = ip.sample('a', 50);
    expect(t?.position.x).toBeCloseTo(5, 5);
  });
  it('snaps on large distance', () => {
    const ip = new TransformInterpolator({ delayMs: 0, snapDistance: 1 });
    ip.push('a', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    ip.push('a', { seq: 2, t: 100, pos: { x: 10, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    const t = ip.sample('a', 50);
    // snap to nearest (50 closer to? equal -> a? implementation: target-a.t < b.t-target => 50<50 false -> b)
    expect([0, 10]).toContain(t?.position.x);
  });
  it('applies 100ms delay', () => {
    const ip = new TransformInterpolator({ delayMs: 100 });
    ip.push('a', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    ip.push('a', { seq: 2, t: 200, pos: { x: 10, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    // now=150 => target=50 => interpolate 0..200 at 50 => 2.5
    const t = ip.sample('a', 150);
    expect(t?.position.x).toBeCloseTo(2.5, 5);
  });
  it('has() tracks data', () => {
    const ip = new TransformInterpolator();
    expect(ip.has('a')).toBe(false);
    ip.push('a', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    expect(ip.has('a')).toBe(true);
  });
  it('clear removes', () => {
    const ip = new TransformInterpolator();
    ip.push('a', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    ip.clear('a');
    expect(ip.has('a')).toBe(false);
  });
});
