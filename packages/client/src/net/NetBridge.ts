import type { ObjectDef, Quat, Vec3 } from '@chambler/shared';
import type { ObjectManager } from '../object/ObjectManager.js';
import type { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { TransformInterpolator } from './TransformInterpolator.js';

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
}

export class NetBridge {
  readonly objectManager: ObjectManager;
  readonly localPlayerId: string;
  private networkClient: NetworkClientLike | null;
  readonly interpolator: TransformInterpolator;
  private wiredLocal = false;
  private wiredRemote = false;
  private unsubscribers: Array<() => void> = [];
  private offline = true;

  constructor(opts: BridgeOptions) {
    this.objectManager = opts.objectManager;
    this.localPlayerId = opts.localPlayerId;
    this.networkClient = opts.networkClient ?? null;
    this.interpolator = opts.interpolator ?? new TransformInterpolator();
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
      const room = this.networkClient?.getRoom() as null | { send: (type: string, payload: unknown) => void };
      if (!room || this.isOffline) return;
      try {
        room.send(type, payload);
      } catch {
        // ignore
      }
    };

    this.unsubscribers.push(
      emitter.on('objectSpawn', (def) => {
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
      }),
    );
    this.unsubscribers.push(
      emitter.on('transformUpdate', (m) => {
        send('transformUpdate', {
          id: m.id,
          transform: m.transform,
          velocity: m.velocity,
          seq: Date.now(),
          t: Date.now(),
        });
      }),
    );
    this.unsubscribers.push(
      emitter.on('flip', (e) => {
        send('flip', { objectId: e.objectId, faceUp: e.faceUp });
      }),
    );
  }

  wireRemote(): void {
    if (this.wiredRemote) return;
    const room = this.networkClient?.getRoom() as null | {
      send: (type: string, payload: unknown) => void;
      onMessage: (type: string, cb: (message: unknown) => void) => void;
    };
    if (!room) return;
    this.wiredRemote = true;

    room.onMessage('objectSpawn', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const obj = (m.object ?? message) as Record<string, unknown>;
      if (!obj || typeof obj.id !== 'string') return;
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
      if (typeof id === 'string') this.objectManager.remove(id);
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

    room.onMessage('transformUpdate', (message: unknown) => {
      const m = (message ?? {}) as Record<string, unknown>;
      const id = m.id;
      if (typeof id !== 'string') return;
      if (this.objectManager.isLocked(id, this.localPlayerId)) {
        // remote-owned: buffer transform
      }
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
    const room = this.networkClient?.getRoom() as null | { send: (type: string, payload: unknown) => void };
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
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}

// aliases
export { NetBridge as Bridge };
export { NetBridge as NetworkBridge };
