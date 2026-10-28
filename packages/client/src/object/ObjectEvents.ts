import type { ObjectDef, Transform, Vec3 } from '@chambler/shared';
import { TRANSFORM_RATE_HZ } from '@chambler/shared';
import { cloneTransform } from '@chambler/shared';

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

  /** Per-object throttle state: Map<objectId, lastSentAt (ms)>. */
  readonly lastTransformEmit = new Map<string, number>();

  /** Deferred (rate-limited) frames, last one wins per object. */
  readonly pendingTransforms = new Map<string, { transform: Transform; velocity?: Vec3; dueAt: number }>();

  /** Back-compat alias for the per-object throttle map. */
  get lastSentAt(): Map<string, number> {
    return this.lastTransformEmit;
  }

  private readonly intervalMs = 1000 / TRANSFORM_RATE_HZ;
  private readonly maxTracked = 1024;

  private nowDefault(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  emitTransformUpdate(
    id: string,
    transform: Transform,
    velocity?: Vec3,
    now: number = this.nowDefault(),
  ): boolean {
    if (typeof now !== 'number' || !Number.isFinite(now)) now = this.nowDefault();

    const last = this.lastTransformEmit.get(id);

    // Monotonic-clock resilience: a backward jump is ignored, never throws.
    if (last !== undefined && now < last) {
      return false;
    }

    if (last === undefined || now - last >= this.intervalMs) {
      this.lastTransformEmit.set(id, now);
      this.pendingTransforms.delete(id);
      this.trimSize();
      this.emit('transformUpdate', {
        type: 'transformUpdate',
        id,
        transform,
        velocity,
      });
      return true;
    }

    // Deferred (not dropped): newer data replaces the pending one (last frame wins).
    const dueAt = (last ?? now) + this.intervalMs;
    this.pendingTransforms.set(id, {
      transform: cloneTransform(transform),
      velocity: velocity ? { x: velocity.x, y: velocity.y, z: velocity.z } : undefined,
      dueAt,
    });
    this.trimSize();
    return false;
  }

  /** Emits deferred frames whose due time has arrived. Returns count emitted. */
  flush(now: number = this.nowDefault()): number {
    if (typeof now !== 'number' || !Number.isFinite(now)) now = this.nowDefault();
    let emitted = 0;
    for (const id of Array.from(this.pendingTransforms.keys())) {
      const pending = this.pendingTransforms.get(id);
      if (!pending) continue;
      const last = this.lastTransformEmit.get(id);
      if (last !== undefined && now < last) continue;
      if (now < pending.dueAt) continue;
      this.pendingTransforms.delete(id);
      const emitAt = Math.max(pending.dueAt, last ?? pending.dueAt);
      this.lastTransformEmit.set(id, emitAt);
      this.emit('transformUpdate', {
        type: 'transformUpdate',
        id,
        transform: pending.transform,
        velocity: pending.velocity,
      });
      emitted++;
    }
    this.trimSize();
    return emitted;
  }

  /** Aliases for flush. */
  flushDeferred(now: number = this.nowDefault()): number {
    return this.flush(now);
  }
  tick(now: number = this.nowDefault()): number {
    return this.flush(now);
  }
  pump(now: number = this.nowDefault()): number {
    return this.flush(now);
  }

  /** Removes throttle state for an object (objectRemove / release). */
  forget(id: string): void {
    this.lastTransformEmit.delete(id);
    this.pendingTransforms.delete(id);
  }

  /** Aliases for forget. */
  remove(id: string): void {
    this.forget(id);
  }
  removeObject(id: string): void {
    this.forget(id);
  }
  forgetObject(id: string): void {
    this.forget(id);
  }
  cleanup(id: string): void {
    this.forget(id);
  }
  delete(id: string): void {
    this.forget(id);
  }
  clearThrottle(id?: string): void {
    if (id === undefined) this.resetThrottle();
    else this.forget(id);
  }
  releaseThrottle(id: string): void {
    this.forget(id);
  }

  resetThrottle(id?: string): void {
    if (id === undefined) {
      this.lastTransformEmit.clear();
      this.pendingTransforms.clear();
    } else {
      this.forget(id);
    }
  }

  private trimSize(): void {
    while (this.lastTransformEmit.size > this.maxTracked) {
      const oldest = this.lastTransformEmit.keys().next().value;
      if (oldest === undefined) break;
      this.lastTransformEmit.delete(oldest);
      this.pendingTransforms.delete(oldest);
    }
    while (this.pendingTransforms.size > this.maxTracked) {
      const oldest = this.pendingTransforms.keys().next().value;
      if (oldest === undefined) break;
      this.pendingTransforms.delete(oldest);
    }
  }
}
