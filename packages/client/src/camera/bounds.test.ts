import { describe, expect, it } from 'vitest';
import { clamp, CAMERA_TARGET_BOUNDS } from './bounds.js';

describe('camera bounds', () => {
  it('clamps target inside table bounds', () => {
    expect(clamp(100, CAMERA_TARGET_BOUNDS.minX, CAMERA_TARGET_BOUNDS.maxX)).toBe(
      CAMERA_TARGET_BOUNDS.maxX,
    );
    expect(clamp(-100, CAMERA_TARGET_BOUNDS.minZ, CAMERA_TARGET_BOUNDS.maxZ)).toBe(
      CAMERA_TARGET_BOUNDS.minZ,
    );
  });
});