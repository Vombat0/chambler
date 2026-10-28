import { generateId } from '@chambler/shared';
import type { ObjectEventEmitter } from './ObjectEvents.js';

export class OwnershipTable {
  private readonly owners = new Map<string, string | null>();

  constructor(private readonly emitter?: ObjectEventEmitter) {}

  init(objectId: string, ownerId: string | null = null): void {
    this.owners.set(objectId, ownerId);
  }

  remove(objectId: string): void {
    this.owners.delete(objectId);
    this.emitter?.forget(objectId);
  }

  getOwner(objectId: string): string | null {
    return this.owners.get(objectId) ?? null;
  }

  isOwnedByOther(objectId: string, playerId: string): boolean {
    const o = this.getOwner(objectId);
    return o !== null && o !== playerId;
  }

  claim(objectId: string, playerId: string, claimToken = generateId('claim')): boolean {
    if (this.isOwnedByOther(objectId, playerId)) return false;
    this.owners.set(objectId, playerId);
    this.emitter?.emit('objectClaim', { objectId, playerId, claimToken });
    return true;
  }

  release(objectId: string, playerId: string): boolean {
    if (this.getOwner(objectId) !== playerId) return false;
    this.owners.set(objectId, null);
    this.emitter?.forget(objectId);
    this.emitter?.emit('objectRelease', { objectId, playerId });
    return true;
  }

  reset(): void {
    this.owners.clear();
  }
}
