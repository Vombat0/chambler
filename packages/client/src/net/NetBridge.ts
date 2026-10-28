import {
  decodeTransformBatch,
  unwrapTimestamp,
  type ObjectDef,
  type Quat,
  type Vec3,
} from '@chambler/shared';
import type { ObjectManager } from '../object/ObjectManager.js';
import type { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { TransformInterpolator } from './TransformInterpolator.js';
import { TransformSender } from './TransformSender.js';

export interface NetworkClientLike {
  getRoom(): unknown;
  getStatus(): string;
  onStatus(cb: (s: string, a: number) => void): () => void;
}

export interface BridgeOptions {
  localPlayerId: string;
  objectManager: ObjectManager;
  networkClient?: NetworkClientLike | null;
  interpolator?: TransformInterpolator;
  /** Motion-gated binary sender; injectable for tests. */
  sender?: TransformSender;
}

interface RoomLike {
  send: (type: string, payload: unknown) => void;
  onMessage: (type: string, cb: (message: unknown) => void) => void;
}

/** Normalises a transport payload (msgpack `bin`) into bytes. */
function toBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload) && payload.every((v) => typeof v === 'number')) {
    return Uint8Array.from(payload as number[]);
  }
  return null;
}

/**
 * Bridges the local object manager to the room.
 *
 * Outbound transforms (B3) go through `TransformSender`: still objects cost
 * nothing, moving objects are sampled at 20/5 Hz and every tick is packed into
 * one binary `transformBatch` packet instead of one JSON message per object.
 * Inbound batches are decoded and pushed into the interpolator.
 */
export class NetBridge {
  readonly objectManager: ObjectManager;
  readonly localPlayerId: string;
  private networkClient: NetworkClientLike | null;
  readonly interpolator: TransformInterpolator;
  readonly sender: TransformSender;
  private wiredLocal = false;
  private wiredRemote = false;
  private unsubscribers: Array<() => void> = [];
  private offline = true;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: BridgeOptions) {
    this.objectManager = opts.objectManager;
    this.localPlayerId = opts.localPlayerId;
    this.networkClient = opts.networkClient ?? null;
    this.interpolator = opts.interpolator ?? new TransformInterpolator();
    this.sender = opts.sender ?? new TransformSender();
    this.offline = !this.networkClient || this.networkClient.getStatus() !== 'connected';
  }

  setNetworkClient(nc: NetworkClientLike | null): void {
    this.networkClient = nc;
    if (nc) {
      const off = nc.onStatus((s) => {
        this.offline = s !== 'connected';
        if (!this.offline) {
          this.wireRemote();
          this.pushLocalSnapshot();
        }
      });
      this.unsubscribers.push(off);
    }
  }

  get isOffline(): boolean {
    return this.offline || !this.networkClient || this.networkClient.getStatus() !== 'connected';
  }

  wireLocal(): void {
    if (this.wiredLocal) return;
    this.wiredLocal = true;
    const emitter: ObjectEventEmitter = this.objectManager.emitter;
    const send = (type: string, payload: unknown) => {
      const room = this.networkClient?.getRoom() as null | RoomLike;
      if (!room || this.isOffline) return;
      try {
        room.send(type, payload);
      } catch {
        // ignore
      }
    };

    this.unsubscribers.push(
      emitter.on('objectSpawn', (def) => {
        this.adoptIndex(def.id, def.netIndex);
        send('objectSpawn', { object: def });
      }),
    );
    this.unsubscribers.push(
      emitter.on('objectClaim', (e) => {
        send('objectClaim', { objectId: e.objectId });
      }),
    );
    this.unsubscribers.push(
      emitter.on('objectRelease', (e) => {
        send('objectRelease', { objectId: e.objectId });
        this.sender.forget(e.objectId);
      }),
    );
    this.unsubscribers.push(
      emitter.on('transformUpdate', (m) => {
        // Motion filter + rate control; the actual packet goes out on flush.
        this.sender.enqueue(m.id, m.transform, m.velocity);
        this.scheduleFlush();
      }),
    );
    this.unsubscribers.push(
      emitter.on('flip', (e) => {
        send('flip', { objectId: e.objectId, faceUp: e.faceUp });
      }),
    );
    this.unsubscribers.push(
      emitter.on('dieResult', (e) => {
        send('dieResult', { objectId: e.id, value: e.value });
      }),
    );
  }

  wireRemote(): void {
    if (this.wiredRemote) return;
    const room = this.networkClient?.getRoom() as null | RoomLike;
    if (!room) return;
    this.wiredRemote = true;

    room.onMessage('objectSpawn', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const obj = (m.object ?? message) as Record<string, unknown>;
      if (!obj || typeof obj.id !== 'string') return;
      this.adoptIndex(obj.id, typeof obj.netIndex === 'number' ? obj.netIndex : undefined);
      if (!this.objectManager.get(obj.id)) {
        try {
          this.objectManager.spawn(obj as unknown as ObjectDef);
        } catch {
          // ignore
        }
      }
    });

    room.onMessage('objectRemove', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.objectId ?? m.id;
      if (typeof id === 'string') {
        this.objectManager.remove(id);
        this.sender.forget(id);
      }
    });

    room.onMessage('objectClaim', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.objectId;
      const ownerId = m.playerId ?? m.ownerId;
      if (typeof id !== 'string') return;
      const mo = this.objectManager.get(id);
      if (mo) {
        mo.def.ownerId = (ownerId as string | null) ?? mo.def.ownerId;
        this.objectManager.ownership.claim(id, (ownerId as string) ?? this.localPlayerId);
      }
    });

    room.onMessage('objectRelease', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.objectId;
      if (typeof id !== 'string') return;
      const mo = this.objectManager.get(id);
      if (mo) {
        mo.def.ownerId = null;
        this.objectManager.ownership.release(id, (mo.def.ownerId as string | null) ?? this.localPlayerId);
      }
      // release by id regardless of owner
      try {
        (this.objectManager.ownership as unknown as { owners?: Map<string, string | null> }).owners?.set(id, null);
      } catch {
        // ignore
      }
    });

    room.onMessage('flip', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.objectId;
      if (typeof id !== 'string') return;
      if (typeof m.faceUp === 'boolean') {
        this.objectManager.updateDef(id, { faceUp: m.faceUp as boolean });
      }
    });

    // Binary transform batch (B3): one packet carries many objects.
    room.onMessage('transformBatch', (message: unknown) => {
      const bytes = toBytes(message);
      if (!bytes) return;
      let frames;
      try {
        frames = decodeTransformBatch(bytes).frames;
      } catch {
        return;
      }
      const now = Date.now();
      for (const frame of frames) {
        const id = this.sender.idTable.idOf(frame.index);
        if (!id) continue;
        this.interpolator.push(id, {
          seq: frame.seq,
          t: unwrapTimestamp(frame.t, now),
          pos: frame.position,
          rot: frame.rotation,
          vel: frame.velocity,
        });
      }
    });

    // Authoritative die result (B3).
    room.onMessage('dieResult', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.objectId;
      const value = m.value;
      if (typeof id !== 'string' || typeof value !== 'number') return;
      const mo = this.objectManager.get(id);
      if (mo) {
        this.objectManager.updateDef(id, {
          meta: { ...mo.def.meta, dieValue: value, dieFaces: m.faces ?? mo.def.meta.faces },
        });
      }
      this.objectManager.emitter.emit('dieResult', { id, value });
    });

    // Legacy JSON transform frame (deprecated, still accepted).
    room.onMessage('transformUpdate', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.id;
      if (typeof id !== 'string') return;
      const transform = m.transform;
      if (!transform) return;
      this.interpolator.push(id, {
        seq: typeof m.seq === 'number' ? (m.seq as number) : 0,
        t: typeof m.t === 'number' ? (m.t as number) : Date.now(),
        pos: (transform as Record<string, unknown>).position as Vec3,
        rot: (transform as Record<string, unknown>).rotation as Quat,
        vel: m.velocity as Vec3 | undefined,
      });
    });
  }

  /** Adopts the server-assigned transform index for an object. */
  private adoptIndex(id: string, index: number | undefined): void {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return;
    try {
      this.sender.registerIndex(id, index);
    } catch {
      // A local index was already handed out for this id: rebind to the server's.
      this.sender.idTable.delete(id);
      try {
        this.sender.registerIndex(id, index);
      } catch {
        // keep the local index; the server will reject frames for it
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushTransforms();
    }, 0);
  }

  /** Sends everything queued in the motion filter as binary batches. */
  flushTransforms(now: number = Date.now()): number {
    const room = this.networkClient?.getRoom() as null | RoomLike;
    if (!room || this.isOffline) return 0;
    return this.sender.flushTo(now, (bytes) => {
      try {
        room.send('transformBatch', bytes);
      } catch {
        // ignore
      }
    });
  }

  applyRemoteTransforms(now: number = Date.now()): void {
    for (const mo of this.objectManager.list()) {
      const id = mo.def.id;
      if (mo.def.ownerId !== null && mo.def.ownerId !== this.localPlayerId) {
        const t = this.interpolator.sample(id, now);
        if (t) {
          mo.mesh.position.set(t.position.x, t.position.y, t.position.z);
          mo.mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
        }
      }
    }
  }

  pushLocalSnapshot(): void {
    const room = this.networkClient?.getRoom() as null | RoomLike;
    if (!room || this.isOffline) return;
    for (const mo of this.objectManager.list()) {
      try {
        room.send('objectSpawn', { object: mo.def });
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}

// aliases
export { NetBridge as Bridge };
export { NetBridge as NetworkBridge };
