import {
  decodeTransformBatch,
  unwrapTimestamp,
  type ObjectDef,
  type Quat,
  type TableResyncMessage,
  type Transform,
  type Vec3,
} from '@chambler/shared';
import type { ManagedObject, ObjectManager } from '../object/ObjectManager.js';
import type { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { TransformInterpolator } from './TransformInterpolator.js';
import { TransformSender } from './TransformSender.js';

export interface NetworkClientLike {
  getRoom(): unknown;
  getStatus(): string;
  onStatus(cb: (s: string, a: number) => void): () => void;
  /** B4: full-table resync stream; NetworkClient implements it. */
  onResync?(cb: (m: TableResyncMessage) => void): () => void;
}

export interface BridgeOptions {
  localPlayerId: string;
  objectManager: ObjectManager;
  networkClient?: NetworkClientLike | null;
  interpolator?: TransformInterpolator;
  /** Motion-gated binary sender; injectable for tests. */
  sender?: TransformSender;
  /** Max intents remembered while offline (default 256). */
  offlineQueueLimit?: number;
}

interface RoomLike {
  send: (type: string, payload: unknown) => void;
  onMessage: (type: string, cb: (message: unknown) => void) => void;
}

/** A local change made while offline, waiting for reconciliation. */
interface QueuedIntent {
  type: string;
  payload: unknown;
  objectId: string | undefined;
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

/** Intent types worth replaying after a reconnect (transforms are not). */
const QUEUEABLE_TYPES = new Set([
  'objectSpawn',
  'objectClaim',
  'objectRelease',
  'flip',
  'dieResult',
]);

/**
 * Bridges the local object manager to the room.
 *
 * Outbound transforms (B3) go through `TransformSender`: still objects cost
 * nothing, moving objects are sampled at 20/5 Hz and every tick is packed into
 * one binary `transformBatch` packet instead of one JSON message per object.
 * Inbound batches are decoded and pushed into the interpolator.
 *
 * B4 adds the reconnection flow: while offline, local intents (spawn/claim/
 * release/flip/dieResult) are queued; on reconnect the server's
 * `tableResync` rebuilds the table authoritatively and the queue is replayed
 * with server-wins conflict rules — anything the resync removed or re-owns
 * to someone else is dropped in favour of the server's state.
 */
export class NetBridge {
  readonly objectManager: ObjectManager;
  readonly localPlayerId: string;
  private networkClient: NetworkClientLike | null;
  readonly interpolator: TransformInterpolator;
  readonly sender: TransformSender;
  private wiredLocal = false;
  /** Room instance the remote handlers are currently bound to (B4). */
  private wiredRoom: RoomLike | null = null;
  private unsubscribers: Array<() => void> = [];
  private offline = true;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offlineQueueLimit: number;
  private offlineQueue: QueuedIntent[] = [];
  /** True while a tableResync is being applied: local echoes are dropped. */
  private applyingResync = false;
  /** Ids of spawns replayed after a resync: their local echo is not re-sent. */
  private readonly replayedSpawnIds = new Set<string>();
  /** pushLocalSnapshot runs once per bridge, on the first connect only. */
  private hasPushedSnapshot = false;

  constructor(opts: BridgeOptions) {
    this.objectManager = opts.objectManager;
    this.localPlayerId = opts.localPlayerId;
    this.interpolator = opts.interpolator ?? new TransformInterpolator();
    this.sender = opts.sender ?? new TransformSender();
    this.offlineQueueLimit = Math.max(0, opts.offlineQueueLimit ?? 256);
    this.networkClient = null;
    if (opts.networkClient) this.setNetworkClient(opts.networkClient);
  }

  setNetworkClient(nc: NetworkClientLike | null): void {
    this.networkClient = nc;
    if (!nc) return;
    const off = nc.onStatus((s) => {
      this.offline = s !== 'connected';
      if (!this.offline) {
        // B4: re-wire on every (re)connect — each reconnect is a new Room.
        this.wireRemote();
        if (!this.hasPushedSnapshot) {
          this.hasPushedSnapshot = true;
          this.pushLocalSnapshot();
        } else {
          // Reconnect: reconcile the offline queue against the resynced
          // table (server wins) instead of pushing a full local snapshot.
          this.replayOfflineQueue();
        }
      }
    });
    this.unsubscribers.push(off);
    if (typeof nc.onResync === 'function') {
      const offResync = nc.onResync((m) => this.applyResync(m));
      this.unsubscribers.push(offResync);
    }
  }

  get isOffline(): boolean {
    return this.offline || !this.networkClient || this.networkClient.getStatus() !== 'connected';
  }

  /** Intents queued while offline, waiting for reconciliation. */
  get pendingOfflineIntents(): number {
    return this.offlineQueue.length;
  }

  wireLocal(): void {
    if (this.wiredLocal) return;
    this.wiredLocal = true;
    const emitter: ObjectEventEmitter = this.objectManager.emitter;
    const send = (type: string, payload: unknown, objectId?: string) => {
      if (this.applyingResync) return; // echo of a server-driven local update
      const room = this.networkClient?.getRoom() as null | RoomLike;
      if (!room || this.isOffline) {
        this.queueOffline(type, payload, objectId);
        return;
      }
      try {
        room.send(type, payload);
      } catch {
        // ignore
      }
    };

    this.unsubscribers.push(
      emitter.on('objectSpawn', (def) => {
        this.adoptIndex(def.id, def.netIndex);
        if (this.replayedSpawnIds.size > 0 && this.replayedSpawnIds.delete(def.id)) {
          return; // echo of our own replayed spawn — the server already has it
        }
        send('objectSpawn', { object: def }, def.id);
      }),
    );
    this.unsubscribers.push(
      emitter.on('objectClaim', (e) => {
        send('objectClaim', { objectId: e.objectId }, e.objectId);
      }),
    );
    this.unsubscribers.push(
      emitter.on('objectRelease', (e) => {
        send('objectRelease', { objectId: e.objectId }, e.objectId);
        this.sender.forget(e.objectId);
      }),
    );
    this.unsubscribers.push(
      emitter.on('transformUpdate', (m) => {
        // Motion filter + rate control; the actual packet goes out on flush.
        // Transforms are never queued: they are unreliable and stale offline.
        this.sender.enqueue(m.id, m.transform, m.velocity);
        this.scheduleFlush();
      }),
    );
    this.unsubscribers.push(
      emitter.on('flip', (e) => {
        send('flip', { objectId: e.objectId, faceUp: e.faceUp }, e.objectId);
      }),
    );
    this.unsubscribers.push(
      emitter.on('dieResult', (e) => {
        send('dieResult', { objectId: e.id, value: e.value }, e.id);
      }),
    );
  }

  wireRemote(): void {
    const room = this.networkClient?.getRoom() as null | RoomLike;
    if (!room) return;
    if (this.wiredRoom === room) return;
    this.wiredRoom = room;

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

  /* ------------------------ B4: resync + offline queue ----------------------- */

  /**
   * Applies a full-table resync: the server's table wins. Existing objects
   * are refreshed (def, ownership, transform), missing ones are spawned,
   * local-only ones are removed, and every buffered remote frame is dropped
   * so the interpolator does not blend pre-disconnect poses into the new
   * table (no snap/jump). Afterwards the offline queue is reconciled.
   */
  private applyResync(m: TableResyncMessage): void {
    const objects = Array.isArray(m.objects) ? m.objects : [];
    const seen = new Set<string>();
    this.applyingResync = true;
    this.replayedSpawnIds.clear();
    try {
      for (const def of objects) {
        if (!def || typeof def.id !== 'string') continue;
        seen.add(def.id);
        this.adoptIndex(def.id, def.netIndex);
        const existing = this.objectManager.get(def.id);
        if (existing) {
          this.objectManager.updateDef(def.id, def);
          existing.def.ownerId = def.ownerId ?? null;
          this.objectManager.ownership.init(def.id, def.ownerId ?? null);
          this.applyTransformToObject(existing, def.transform);
        } else {
          try {
            this.objectManager.spawn(def);
          } catch {
            // ignore
          }
        }
      }
      for (const mo of this.objectManager.list()) {
        if (!seen.has(mo.def.id)) {
          this.objectManager.remove(mo.def.id);
          this.sender.forget(mo.def.id);
        }
      }
      this.interpolator.resetAll();
    } finally {
      this.applyingResync = false;
    }
  }

  /** Teleports an existing object to its resync transform (mesh + body). */
  private applyTransformToObject(mo: ManagedObject, t: Transform | undefined): void {
    if (!t || !t.position || !t.rotation) return;
    mo.mesh.position.set(t.position.x, t.position.y, t.position.z);
    mo.mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    // Best-effort physics teleport; test fakes have no rigidBody methods.
    const rigidBody = (mo.body as { rigidBody?: unknown } | undefined)?.rigidBody as
      | {
          setTranslation?: (v: Vec3, wake: boolean) => void;
          setRotation?: (q: Quat, wake: boolean) => void;
        }
      | undefined;
    try {
      rigidBody?.setTranslation?.({ x: t.position.x, y: t.position.y, z: t.position.z }, true);
      rigidBody?.setRotation?.(
        { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z, w: t.rotation.w },
        true,
      );
    } catch {
      // ignore
    }
  }

  private queueOffline(type: string, payload: unknown, objectId: string | undefined): void {
    if (!QUEUEABLE_TYPES.has(type)) return;
    this.offlineQueue.push({ type, payload, objectId });
    if (this.offlineQueue.length > this.offlineQueueLimit) {
      this.offlineQueue.splice(0, this.offlineQueue.length - this.offlineQueueLimit);
    }
  }

  /**
   * Replays the offline queue with server-wins rules: the resync has already
   * rebuilt the table, so intents that now conflict with it are dropped —
   * objects the server removed, claims on objects someone else owns, and
   * spawns of objects the server already has. Transforms were never queued.
   */
  private replayOfflineQueue(): void {
    const room = this.networkClient?.getRoom() as null | RoomLike;
    if (!room || this.isOffline) return; // keep the queue for the next connect
    const queue = this.offlineQueue;
    this.offlineQueue = [];
    for (const intent of queue) {
      if (intent.objectId !== undefined) {
        const mo = this.objectManager.get(intent.objectId);
        if (intent.type === 'objectSpawn') {
          // The resync removed objects the server never had; an offline
          // spawn of a now-missing object is re-sent (recreate). If the
          // object survived the resync the server already has it — skip.
          if (mo) continue; // server already has it — server wins
        } else {
          if (!mo) continue; // server removed it — server wins
          const owner = mo.def.ownerId ?? null;
          if (
            (intent.type === 'objectRelease' || intent.type === 'dieResult') &&
            owner !== this.localPlayerId
          ) {
            continue; // not ours anymore — server wins
          }
          if (
            (intent.type === 'objectClaim' || intent.type === 'flip') &&
            owner !== null &&
            owner !== this.localPlayerId
          ) {
            continue; // someone else owns it — server wins
          }
        }
      }
      try {
        if (intent.type === 'objectSpawn' && intent.objectId !== undefined) {
          this.replayedSpawnIds.add(intent.objectId);
        }
        room.send(intent.type, intent.payload);
      } catch {
        // ignore
      }
    }
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
    this.offlineQueue = [];
    this.wiredRoom = null;
  }
}

// aliases
export { NetBridge as Bridge };
export { NetBridge as NetworkBridge };
