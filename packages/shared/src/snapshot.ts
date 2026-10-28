/**
 * Table snapshot format (B4) — persistence contract, ZERO runtime deps.
 *
 * A `TableSnapshot` is the complete durable state of one table: everything a
 * restarted server needs to put the room back exactly as it was. It is written
 * by the server (`SnapshotStore`) as UTF-8 JSON and validated by the same
 * hand-written validators on the way back in — no schema library, no zod.
 *
 * SECURITY RULE (secret hand): the face of a face-down card never enters a
 * snapshot. `sanitizeObjectForSnapshot` strips a face-down card's identity
 * (meta.cardId/secret keys, assetRef gets a `#back` suffix) and removes any
 * cardId->face mapping from decks. Only the deck order / identity list
 * (`meta.cardIds` on a deck) survives. See `snapshotSecretLeak`.
 */

import type { ObjectDef, Transform } from './types.js';
import { isObjectDef, isTransform, type ValidationResult } from './validators.js';

/** Bump on breaking changes; loaders reject anything they do not know. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Error code used when a snapshot carries an unknown schemaVersion. */
export const SNAPSHOT_VERSION_UNSUPPORTED = 'SNAPSHOT_VERSION_UNSUPPORTED';

/** Hard cap for the serialised snapshot (bytes). */
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

/** Default cap of snapshots kept on disk before the oldest is deleted. */
export const DEFAULT_MAX_SAVES = 50;

/** One seated player as remembered by a snapshot. */
export interface PlayerSnapshot {
  name: string;
  color: string;
  seat: number;
  isHost: boolean;
}

/**
 * One object as remembered by a snapshot. Same shape as `ObjectDef` plus the
 * last-known transform (transforms normally live only on the unreliable
 * channel, so persistence needs its own copy) and the die bookkeeping.
 */
export interface ObjectSnapshotData {
  id: string;
  kind: ObjectDef['kind'];
  assetRef: string;
  transform: Transform;
  ownerId: string | null;
  locked: boolean;
  faceUp: boolean;
  meta: Record<string, unknown>;
  netIndex?: number;
}

/** Authoritative die result remembered per object id. */
export interface DieValueSnapshot {
  value: number;
  rolledBy: string;
  rolledAt: number;
}

/** Complete durable state of one table. */
export interface TableSnapshot {
  schemaVersion: number;
  roomCode: string;
  createdAt: number;
  savedAt: number;
  objects: ObjectSnapshotData[];
  players: PlayerSnapshot[];
  dieValues: Record<string, DieValueSnapshot>;
  /** Opaque game-package state (turn order, helper markers, ...). */
  turnState?: unknown;
}

/* ------------------------------------------------------------------ */
/* Secret-face rules                                                   */
/* ------------------------------------------------------------------ */

/** Keys that reveal a face-down card's own identity. */
export const SNAPSHOT_CARD_IDENTITY_KEYS = ['cardId', 'hiddenCard', 'secret'] as const;

/** Keys that map a card id to its face — never persisted unencrypted. */
export const SNAPSHOT_FACE_MAPPING_KEYS = [
  'faces',
  'faceMap',
  'cardFaces',
  'faceMapping',
  'faceById',
  'cardFace',
] as const;

function stripKeys(meta: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...meta };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Returns the object as it may appear inside a snapshot.
 *
 * - face-down `card`: identity keys removed, `assetRef` masked with `#back`.
 * - `deck`: the order / identity list (`cardIds`) is kept, every id->face
 *   mapping key is removed.
 * - everything else (face-up cards included — their face is public knowledge
 *   at the table) only loses face-mapping keys.
 */
export function sanitizeObjectForSnapshot(object: ObjectDef): ObjectSnapshotData {
  const kind = object.kind;
  let meta = stripKeys(object.meta, SNAPSHOT_FACE_MAPPING_KEYS);
  let assetRef = object.assetRef;
  if (kind === 'card' && !object.faceUp) {
    meta = stripKeys(meta, SNAPSHOT_CARD_IDENTITY_KEYS);
    if (assetRef) assetRef = `${assetRef}#back`;
  }
  return {
    id: object.id,
    kind,
    assetRef,
    transform: object.transform,
    ownerId: object.ownerId,
    locked: object.locked,
    faceUp: object.faceUp,
    meta,
    netIndex: object.netIndex,
  };
}

/**
 * Guard used before a snapshot is written and by tests: returns the first
 * secret-face violation found, or null when the snapshot is clean.
 */
export function snapshotSecretLeak(snapshot: TableSnapshot): string | null {
  for (const object of snapshot.objects) {
    for (const key of SNAPSHOT_FACE_MAPPING_KEYS) {
      if (key in object.meta) return `${object.id}: meta.${key} leaks a card-face mapping`;
    }
    if (object.kind === 'card' && !object.faceUp) {
      for (const key of SNAPSHOT_CARD_IDENTITY_KEYS) {
        if (key in object.meta) return `${object.id}: meta.${key} leaks a face-down card identity`;
      }
      if (object.assetRef && !object.assetRef.endsWith('#back')) {
        return `${object.id}: assetRef of a face-down card is not masked`;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Validators (hand-written — shared stays dependency-free)            */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Reads the schemaVersion field without validating the rest (null if absent). */
export function getSnapshotSchemaVersion(v: unknown): number | null {
  if (!isRecord(v)) return null;
  const version = v.schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) ? version : null;
}

function isPlayerSnapshot(v: unknown): v is PlayerSnapshot {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    typeof v.color === 'string' &&
    typeof v.seat === 'number' &&
    Number.isInteger(v.seat) &&
    v.seat >= 0 &&
    v.seat < 64 &&
    typeof v.isHost === 'boolean'
  );
}

function isDieValueSnapshot(v: unknown): v is DieValueSnapshot {
  return (
    isRecord(v) &&
    typeof v.value === 'number' &&
    Number.isInteger(v.value) &&
    v.value >= 0 &&
    typeof v.rolledBy === 'string' &&
    isFiniteNumber(v.rolledAt)
  );
}

function isObjectSnapshotData(v: unknown): v is ObjectSnapshotData {
  return isObjectDef(v) && isTransform((v as ObjectDef).transform);
}

/**
 * Validates a full `TableSnapshot`. An unknown `schemaVersion` is reported as
 * `SNAPSHOT_VERSION_UNSUPPORTED`; structural problems list their fields.
 */
export function validateTableSnapshot(v: unknown): ValidationResult {
  if (!isRecord(v)) {
    return { ok: false, errors: ['snapshot must be an object'] };
  }
  const errors: string[] = [];
  const version = getSnapshotSchemaVersion(v);
  if (version === null) {
    errors.push('schemaVersion must be an integer (SNAPSHOT_VERSION_UNSUPPORTED: missing)');
  } else if (version !== SNAPSHOT_SCHEMA_VERSION) {
    errors.push(
      `SNAPSHOT_VERSION_UNSUPPORTED: snapshot schemaVersion ${version}, this server understands ${SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  if (typeof v.roomCode !== 'string' || v.roomCode.length === 0) {
    errors.push('roomCode must be a non-empty string');
  }
  if (!isFiniteNumber(v.createdAt)) errors.push('createdAt must be a finite number');
  if (!isFiniteNumber(v.savedAt)) errors.push('savedAt must be a finite number');
  if (!Array.isArray(v.objects)) {
    errors.push('objects must be an array');
  } else {
    v.objects.forEach((object, index) => {
      if (!isObjectSnapshotData(object)) {
        errors.push(`objects[${index}] is not a valid ObjectSnapshotData`);
      }
    });
  }
  if (!Array.isArray(v.players)) {
    errors.push('players must be an array');
  } else {
    v.players.forEach((player, index) => {
      if (!isPlayerSnapshot(player)) errors.push(`players[${index}] is not a valid PlayerSnapshot`);
    });
  }
  if (!isRecord(v.dieValues)) {
    errors.push('dieValues must be an object');
  } else {
    for (const [id, die] of Object.entries(v.dieValues)) {
      if (!isDieValueSnapshot(die)) errors.push(`dieValues.${id} is not a valid DieValueSnapshot`);
    }
  }
  if (v.turnState !== undefined && !isRecord(v.turnState) && typeof v.turnState !== 'boolean' && typeof v.turnState !== 'number' && typeof v.turnState !== 'string') {
    errors.push('turnState must be JSON-safe (opaque)');
  }
  return { ok: errors.length === 0, errors };
}
