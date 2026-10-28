/** 3D vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion (w-first, matches Three.js `Quaternion`). */
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** Position + rotation + scale of a table object. */
export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export type ObjectKind = 'die' | 'pawn' | 'token' | 'tile' | 'board' | 'card' | 'deck' | 'custom';

export interface ObjectDef {
  /** Stable unique id (server-assigned at spawn time). */
  id: string;
  kind: ObjectKind;
  /** Asset reference inside a content package, e.g. `risk/die-black`. */
  assetRef: string;
  transform: Transform;
  /**
   * Player currently simulating/holding the object (authoritative owner),
   * or null when it is free/on the table.
   */
  ownerId: string | null;
  locked: boolean;
  /** Only meaningful for `card` / `tile`. */
  faceUp: boolean;
  /** Free-form content-package data. */
  meta: Record<string, unknown>;
}

/**
 * Network-serialisable view of an `ObjectDef`. Structurally identical today;
 * kept as a distinct alias so the wire contract can evolve independently.
 */
export type ObjectSnapshot = ObjectDef;

export interface OwnershipState {
  objectId: string;
  ownerId: string | null;
  locked: boolean;
  /** Claim token minted by the server; used to reject stale transforms. */
  claimToken?: string;
}

/** A single sampled transform on the unreliable transform channel. */
export interface TransformFrame {
  id: string;
  pos: Vec3;
  rot: Quat;
  vel?: Vec3;
  seq: number;
  t: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** CSS/HTML color, e.g. `#ff0000`. */
  color: string;
  seat: number;
  isHost: boolean;
}

/** Result of a die owned by a client; the owning client reads it, the server broadcasts it. */
export interface DieResult {
  id: string;
  value: number;
}

/**
 * A player's hidden hand. SECURITY RULE: `cardIds` must EVER be sent only to
 * `ownerId`'s session — never leaked through state snapshots or broadcast
 * logs to other clients. Treat like a secret.
 */
export interface HandInfo {
  ownerId: string;
  cardIds: string[];
}
