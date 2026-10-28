import type { ObjectDef, Transform, Vec3 } from '@chambler/shared';
import { TRANSFORM_RATE_HZ } from '@chambler/shared';

export interface ClaimEvent {
  objectId: string;
  playerId: string;
  claimToken: string;
}

export interface ReleaseEvent {
  objectId: string;
  playerId: string;
}

export interface FlipEvent {
  objectId: string;
  faceUp: boolean;
}

export type ObjectEventMap = {
  objectSpawn: ObjectDef;
  objectClaim: ClaimEvent;
  objectRelease: ReleaseEvent;
  transformUpdate: {
    type: 'transformUpdate';
    id: string;
    transform: Transform;
    velocity?: Vec3;
  };
  flip: FlipEvent;
  dieResult: { id: string; value: number };
};

export type ObjectEventName = keyof ObjectEventMap;
export type ObjectEventHandler<K extends ObjectEventName> = (payload: ObjectEventMap[K]) => void;

export class ObjectEventEmitter {
  private readonly listeners = new Map<ObjectEventName, Set<(p: unknown) => void>>();

  on<K extends ObjectEventName>(event: K, handler: ObjectEventHandler<K>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    set.add(handler as (p: unknown) => void);
    return () => set.delete(handler as (p: unknown) => void);
  }

  off<K extends ObjectEventName>(event: K, handler: ObjectEventHandler<K>): void {
    this.listeners.get(event)?.delete(handler as (p: unknown) => void);
  }

  emit<K extends ObjectEventName>(event: K, payload: ObjectEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }

  private lastTransformEmit = -Infinity;
  private readonly intervalMs = 1000 / TRANSFORM_RATE_HZ;

  emitTransformUpdate(
    id: string,
    transform: Transform,
    velocity?: Vec3,
    now: number = (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ): boolean {
    if (now - this.lastTransformEmit < this.intervalMs) return false;
    this.lastTransformEmit = now;
    this.emit('transformUpdate', {
      type: 'transformUpdate',
      id,
      transform,
      velocity,
    });
    return true;
  }

  resetThrottle(): void {
    this.lastTransformEmit = -Infinity;
  }
}
