import { Schema, type } from '@colyseus/schema';

/**
 * Colyseus-schema representation of a table object (B2/B3).
 *
 * High-frequency transforms are NOT part of this schema; they travel on the
 * unreliable transform channel. This schema carries the durable state that
 * late joiners and reconnecting clients need (spawn/remove/claim/lock/flip and
 * the last authoritative die result).
 */
export class ObjectState extends Schema {
  @type('string') id = '';
  @type('string') kind = '';
  @type('string') ownerId = '';
  @type('boolean') locked = false;
  @type('boolean') faceUp = true;
  /** JSON-encoded free-form meta (kept small). */
  @type('string') metaJson = '{}';
  /** Asset reference inside a content package. */
  @type('string') assetRef = '';
  /**
   * Stable uint16 index used by the binary transform channel (B3). Assigned at
   * spawn time and never reused inside a room, so both sides agree.
   */
  @type('uint16') netIndex = 0;
  /** Last authoritative die result (0 = not rolled yet). */
  @type('int16') dieValue = 0;
  /** sessionId of the player whose report was accepted ('' = none). */
  @type('string') dieRolledBy = '';
  /** Server clock (ms) when the result was accepted (0 = none). */
  @type('uint64') dieRolledAt = 0;
}

export function ownerIdOrNull(v: string): string | null {
  return v === '' ? null : v;
}

export function ownerIdToSchema(v: string | null): string {
  return v ?? '';
}
