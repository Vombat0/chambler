import { describe, expect, it } from 'vitest';
import { Selection } from './Selection.js';

describe('Selection', () => {
  it('single click replaces', () => {
    const s = new Selection();
    s.click('a', false);
    s.click('b', false);
    expect(s.toArray()).toEqual(['b']);
  });
  it('shift click adds', () => {
    const s = new Selection();
    s.click('a', false);
    s.click('b', true);
    expect(s.size).toBe(2);
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
  });
  it('shift click toggles off', () => {
    const s = new Selection();
    s.click('a', false);
    s.click('a', true);
    expect(s.size).toBe(0);
  });
  it('click empty clears (non-multi)', () => {
    const s = new Selection();
    s.click('a', false);
    s.click(null, false);
    expect(s.size).toBe(0);
  });
  it('group selection multiple', () => {
    const s = new Selection();
    s.click('a', false);
    s.click('b', true);
    s.click('c', true);
    expect(s.size).toBe(3);
  });
});
