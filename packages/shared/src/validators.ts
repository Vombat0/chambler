import type {
  ObjectDef,
  ObjectKind,
  OwnershipState,
  Quat,
  Transform,
  TransformFrame,
  Vec3,
} from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isVec3(v: unknown): v is Vec3 {
  if (!isRecord(v)) return false;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

export function isQuat(v: unknown): v is Quat {
  if (!isRecord(v)) return false;
  return (
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.y) &&
    isFiniteNumber(v.z)
  );
}

export function isTransform(v: unknown): v is Transform {
  if (!isRecord(v)) return false;
  return isVec3(v.position) && isQuat(v.rotation) && isVec3(v.scale);
}

const OBJECT_KINDS: readonly ObjectKind[] = [
  'die',
  'pawn',
  'token',
  'tile',
  'board',
  'card',
  'deck',
  'custom',
];

export function isObjectKind(v: unknown): v is ObjectKind {
  return typeof v === 'string' && (OBJECT_KINDS as readonly string[]).includes(v);
}

export function isObjectDef(v: unknown): v is ObjectDef {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string') return false;
  if (!isObjectKind(v.kind)) return false;
  if (typeof v.assetRef !== 'string') return false;
  if (!isTransform(v.transform)) return false;
  if (v.ownerId !== null && typeof v.ownerId !== 'string') return false;
  if (typeof v.locked !== 'boolean') return false;
  if (typeof v.faceUp !== 'boolean') return false;
  if (!isRecord(v.meta)) return false;
  return true;
}

export const isObjectSnapshot = isObjectDef;

export function isOwnershipState(v: unknown): v is OwnershipState {
  if (!isRecord(v)) return false;
  if (typeof v.objectId !== 'string') return false;
  if (v.ownerId !== null && typeof v.ownerId !== 'string') return false;
  if (typeof v.locked !== 'boolean') return false;
  if (v.claimToken !== undefined && typeof v.claimToken !== 'string') return false;
  return true;
}

export function isTransformFrame(v: unknown): v is TransformFrame {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string') return false;
  if (!isVec3(v.pos)) return false;
  if (!isQuat(v.rot)) return false;
  if (v.vel !== undefined && !isVec3(v.vel)) return false;
  if (typeof v.seq !== 'number' || !Number.isInteger(v.seq)) return false;
  if (typeof v.t !== 'number' || !Number.isFinite(v.t)) return false;
  return true;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateTransformFrame(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(v)) {
    return { ok: false, errors: ['not an object'] };
  }
  if (typeof v.id !== 'string') errors.push('id must be string');
  if (!isVec3(v.pos)) errors.push('pos must be Vec3');
  if (!isQuat(v.rot)) errors.push('rot must be Quat');
  if (v.vel !== undefined && !isVec3(v.vel)) errors.push('vel must be Vec3');
  if (typeof v.seq !== 'number' || !Number.isInteger(v.seq)) errors.push('seq must be integer');
  if (typeof v.t !== 'number' || !Number.isFinite(v.t)) errors.push('t must be finite number');
  return { ok: errors.length === 0, errors };
}

export function validateObjectSnapshot(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObjectDef(v)) errors.push('not a valid ObjectDef/ObjectSnapshot');
  return { ok: errors.length === 0, errors };
}

export function validateOwnershipState(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isOwnershipState(v)) errors.push('not a valid OwnershipState');
  return { ok: errors.length === 0, errors };
}

// Aliases that some callers may use.
export const validateTransform = (v: unknown): ValidationResult => ({
  ok: isTransform(v),
  errors: isTransform(v) ? [] : ['not a valid Transform'],
});
