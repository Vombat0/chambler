import type { HandInfo, ObjectDef, ObjectSnapshot, OwnershipState, PlayerInfo, Transform, TransformFrame, Vec3 } from './types.js';

/**
 * Frequency of the transform channel. State channel messages are sent
 * immediately; transforms are sampled at this rate.
 */
export const TRANSFORM_RATE_HZ = 20;

/** Message name of the binary transform batch (see `transformCodec.ts`). */
export const TRANSFORM_BATCH_MESSAGE = 'transformBatch';

/** Message name of the legacy JSON transform frame (deprecated, B2 compatible). */
export const TRANSFORM_JSON_MESSAGE = 'transformUpdate';

/* ------------------------------------------------------------------ */
/* Motion gating (B3) — a still object costs zero bandwidth.           */
/* ------------------------------------------------------------------ */

/** Position delta below which an object counts as not moving (0.5 mm). */
export const TRANSFORM_MOTION_EPSILON_M = 0.0005;

/** Rotation delta below which an object counts as not rotating (0.1 deg). */
export const TRANSFORM_MOTION_EPSILON_DEG = 0.1;

/** Send interval while the object moves fast (20 Hz). */
export const TRANSFORM_FAST_INTERVAL_MS = 1000 / 20;

/** Send interval while the object moves slowly / comes to rest (5 Hz). */
export const TRANSFORM_SLOW_INTERVAL_MS = 1000 / 5;

/** Linear speed (m/s) above which the fast interval is used. */
export const TRANSFORM_FAST_SPEED_MPS = 0.1;

/** Angular speed (deg/s) above which the fast interval is used. */
export const TRANSFORM_FAST_ANGULAR_DPS = 30;

/** Default room-wide outbound transform budget (bytes/second), env-overridable. */
export const DEFAULT_TRANSFORM_BUDGET_BYTES_PER_SEC = 64 * 1024;

/** Conflict window (ms) during which a die may not report a different value. */
export const DIE_RESULT_CONFLICT_WINDOW_MS = 1500;

/* ------------------------------------------------------------------ */
/* Channel 1: STATE — reliable, ordered, persistent (each server)      */
/* ------------------------------------------------------------------ */

/** Reliable, persistent state channel messages (Colyseus: full-state/schema-bound). */
export type StateChannelMessage =
  | { type: 'join'; player: PlayerInfo }
  | { type: 'leave'; playerId: string }
  | { type: 'objectSpawn'; object: ObjectDef }
  | { type: 'objectRemove'; objectId: string }
  | { type: 'objectClaim'; objectId: string; playerId: string; claimToken: string }
  | { type: 'objectRelease'; objectId: string; playerId: string }
  | { type: 'objectLock'; objectId: string; playerId: string | null; locked: boolean }
  | { type: 'flip'; objectId: string; faceUp: boolean }
  | { type: 'deckShuffle'; deckId: string }
  | { type: 'chat'; playerId: string; text: string; sentAt: number }
  | { type: 'seat'; seat: number }
  | { type: 'color'; color: string }
  | { type: 'hand'; hand: HandInfo }
  | DieResultMessage
  | TableResyncMessage
  | { type: 'error'; code: string; message: string };

/**
 * Authoritative die result (B3). The owning client reads the face after the die
 * stops, the server validates it (1..faces, no conflicting re-report inside the
 * conflict window), persists it in room state and broadcasts it to everyone.
 */
export interface DieResultMessage {
  type: 'dieResult';
  objectId: string;
  /** Player that reported the result (the owner). */
  playerId: string;
  value: number;
  /** Number of faces the server validated against. */
  faces: number;
  /** Server clock (ms) at acceptance. */
  at: number;
}

/**
 * Full-table resync (B4). Sent by the server to a client right after it joins
 * or reconnects: the complete object list with last-known transforms, so the
 * client can rebuild the table and reset interpolation without jumping.
 * Objects are already sanitised per recipient (secret-hand rule).
 */
export interface TableResyncMessage {
  type: 'tableResync';
  roomCode: string;
  objects: ObjectDef[];
  /** Server clock (ms) at send time. */
  serverTime: number;
}

/* ------------------------------------------------------------------ */
/* Channel 2: TRANSFORM — unreliable, unordered, sampled at 20 Hz      */
/* ------------------------------------------------------------------ */

/** Lightweight transform channel message. Losses are tolerated; a claim supersedes. */
export interface TransformChannelMessage {
  type: 'transformUpdate';
  id: string; // object id
  transform: Transform;
  /** Linear velocity, if the owner wants receiving clients to extrapolate. */
  velocity?: Vec3;
  /** Monotonic sequence number for stale-packet rejection. */
  seq?: number;
  /** Sender timestamp (ms). */
  t?: number;
}

export type ChamblerMessage = StateChannelMessage | TransformChannelMessage;

/** Discriminator guard based on the `type` field. */
export function isStateChannelMessage(
  message: ChamblerMessage,
): message is StateChannelMessage {
  return message.type !== 'transformUpdate';
}

export function isTransformChannelMessage(
  message: ChamblerMessage,
): message is TransformChannelMessage {
  return message.type === 'transformUpdate';
}

// Re-export network types for convenience.
export type { ObjectSnapshot, OwnershipState, TransformFrame };
