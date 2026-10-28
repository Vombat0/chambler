import { Schema, type } from '@colyseus/schema';

/**
 * Colyseus-schema representation of a table object (B2).
 *
 * High-frequency transforms are NOT part of this schema; they travel on the
 * unreliable transform channel. This schema carries the durable state that
 * late joiners need (spawn/remove/claim/lock/flip).
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
}

export function ownerIdOrNull(v: string): string | null {
  return v === '' ? null : v;
}

export function ownerIdToSchema(v: string | null): string {
  return v ?? '';
}
