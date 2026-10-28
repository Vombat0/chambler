import type { ObjectDef, PlayerInfo, Transform, Vec3 } from './types.js';

/**
 * Frequency of the transform channel. State channel messages are sent
 * immediately; transforms are sampled at this rate.
 */
export const TRANSFORM_RATE_HZ = 20;

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
  | { type: 'chat'; playerId: string; text: string; sentAt: number };

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
