import type { ObjectDef, ObjectKind, Vec3 } from '@chambler/shared';

export interface ObjectSpec {
  kind: ObjectKind;
  /** Full extents (width, height, depth). */
  size: Vec3;
  shape: 'box' | 'sphere';
  radius?: number;
  mass: number;
  color: string;
  /** Default faceUp for card/tile. */
  faceUp: boolean;
}

export const OBJECT_SPECS: Record<ObjectKind, ObjectSpec> = {
  die: { kind: 'die', size: { x: 0.6, y: 0.6, z: 0.6 }, shape: 'box', mass: 0.05, color: '#e8e8e8', faceUp: true },
  pawn: { kind: 'pawn', size: { x: 0.3, y: 0.6, z: 0.3 }, shape: 'sphere', radius: 0.18, mass: 0.02, color: '#e5533c', faceUp: true },
  token: { kind: 'token', size: { x: 0.25, y: 0.08, z: 0.25 }, shape: 'sphere', radius: 0.12, mass: 0.01, color: '#f2c94c', faceUp: true },
  tile: { kind: 'tile', size: { x: 0.9, y: 0.06, z: 0.9 }, shape: 'box', mass: 0.03, color: '#d9c7a0', faceUp: true },
  board: { kind: 'board', size: { x: 6, y: 0.12, z: 4.5 }, shape: 'box', mass: 0, color: '#8b5a2b', faceUp: true },
  card: { kind: 'card', size: { x: 0.63, y: 0.01, z: 0.88 }, shape: 'box', mass: 0.005, color: '#ffffff', faceUp: true },
  deck: { kind: 'deck', size: { x: 0.66, y: 0.6, z: 0.9 }, shape: 'box', mass: 0.1, color: '#2b2b2b', faceUp: true },
  custom: { kind: 'custom', size: { x: 0.5, y: 0.5, z: 0.5 }, shape: 'box', mass: 0.05, color: '#999999', faceUp: true },
};

export function specFor(def: ObjectDef): ObjectSpec {
  const base = OBJECT_SPECS[def.kind] ?? OBJECT_SPECS.custom;
  return { ...base };
}

export function halfExtents(spec: ObjectSpec): Vec3 {
  return { x: spec.size.x / 2, y: spec.size.y / 2, z: spec.size.z / 2 };
}
