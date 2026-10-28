export const TABLE_HALF_X = 4;
export const TABLE_HALF_Z = 3;

export const CAMERA_TARGET_BOUNDS = {
  minX: -TABLE_HALF_X + 0.5,
  maxX: TABLE_HALF_X - 0.5,
  minZ: -TABLE_HALF_Z + 0.5,
  maxZ: TABLE_HALF_Z - 0.5,
};

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}