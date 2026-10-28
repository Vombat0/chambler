import { TABLE_HALF_X, TABLE_HALF_Z } from '../camera/bounds.js';

export interface TablePoint {
  x: number;
  z: number;
}

export function clampToTable(x: number, z: number, margin = 0.5): TablePoint {
  return {
    x: Math.max(-TABLE_HALF_X + margin, Math.min(TABLE_HALF_X - margin, x)),
    z: Math.max(-TABLE_HALF_Z + margin, Math.min(TABLE_HALF_Z - margin, z)),
  };
}
