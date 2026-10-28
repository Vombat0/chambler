import { describe, expect, it } from 'vitest';
import { clampToTable } from './dragBounds.js';

describe('dragBounds', () => {
  it('inside unchanged', () => {
    expect(clampToTable(0, 0)).toEqual({ x: 0, z: 0 });
  });
  it('clamps x overflow', () => {
    const r = clampToTable(100, 0);
    expect(r.x).toBe(3.5);
  });
  it('clamps z overflow', () => {
    const r = clampToTable(0, -100);
    expect(r.z).toBe(-2.5);
  });
  it('clamps both', () => {
    const r = clampToTable(10, 10);
    expect(r.x).toBe(3.5);
    expect(r.z).toBe(2.5);
  });
});
