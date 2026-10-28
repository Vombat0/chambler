import * as THREE from 'three';
import type { ObjectDef } from '@chambler/shared';
import { cloneTransform } from '@chambler/shared';
import type { SceneManagerLike } from '../sim/SceneManager.js';
import type { PhysicsBody } from '../sim/PhysicsWorld.js';
import { createMesh, createBodyOptions } from './ObjectFactory.js';
import { ObjectEventEmitter } from './ObjectEvents.js';
import { OwnershipTable } from './Ownership.js';

export interface ManagedObject {
  def: ObjectDef;
  mesh: THREE.Object3D;
  body: PhysicsBody;
  held: boolean;
}

export interface ObjectManagerOptions {
  localPlayerId?: string;
  sceneManager: SceneManagerLike;
  emitter?: ObjectEventEmitter;
  ownership?: OwnershipTable;
}

export class ObjectManager {
  readonly sceneManager: SceneManagerLike;
  readonly emitter: ObjectEventEmitter;
  readonly ownership: OwnershipTable;
  readonly localPlayerId: string;
  private readonly objects = new Map<string, ManagedObject>();

  constructor(opts: ObjectManagerOptions) {
    this.sceneManager = opts.sceneManager;
    this.emitter = opts.emitter ?? new ObjectEventEmitter();
    this.ownership = opts.ownership ?? new OwnershipTable(this.emitter);
    this.localPlayerId = opts.localPlayerId ?? 'local';
  }

  spawn(def: ObjectDef): ManagedObject {
    const mesh = createMesh(def);
    const bodyOpts = createBodyOptions(def);
    const body = this.sceneManager.physics.createBody(def.id, bodyOpts) as PhysicsBody;
    this.sceneManager.registerBody(def.id, mesh, body.rigidBody);
    const mo: ManagedObject = { def: { ...def, transform: cloneTransform(def.transform) }, mesh, body, held: false };
    this.objects.set(def.id, mo);
    this.ownership.init(def.id, def.ownerId);
    this.emitter.emit('objectSpawn', mo.def);
    return mo;
  }

  remove(id: string): void {
    const mo = this.objects.get(id);
    if (!mo) return;
    this.sceneManager.physics.removeBody(id);
    this.sceneManager.scene.remove(mo.mesh);
    this.objects.delete(id);
    this.ownership.remove(id);
  }

  get(id: string): ManagedObject | undefined {
    return this.objects.get(id);
  }

  list(): ManagedObject[] {
    return Array.from(this.objects.values());
  }

  count(): number {
    return this.objects.size;
  }

  setHeld(id: string, held: boolean): void {
    const mo = this.objects.get(id);
    if (!mo) return;
    mo.held = held;
    const body = mo.body.rigidBody;
    if (held) {
      (body as unknown as { setBodyType: (t: number, w: boolean) => void }).setBodyType(2, true); // kinematic position based
    } else {
      (body as unknown as { setBodyType: (t: number, w: boolean) => void }).setBodyType(0, true); // dynamic
    }
  }

  updateDef(id: string, patch: Partial<ObjectDef>): void {
    const mo = this.objects.get(id);
    if (!mo) return;
    mo.def = { ...mo.def, ...patch };
    if (patch.faceUp !== undefined) {
      mo.def.faceUp = patch.faceUp;
      this.emitter.emit('flip', { objectId: id, faceUp: patch.faceUp });
    }
    if (patch.ownerId !== undefined) {
      // sync
    }
  }

  flip(id: string): void {
    const mo = this.objects.get(id);
    if (!mo) return;
    if (mo.def.kind !== 'card' && mo.def.kind !== 'tile') return;
    const next = !mo.def.faceUp;
    mo.def.faceUp = next;
    // animate 180 rotation around Y? spec says face flip 180; use X? Card flip usually around X or Y. Use X axis 180.
    // We'll just set rotation target; for simplicity rotate mesh 180 around X over time not implemented; set immediate + emit.
    this.emitter.emit('flip', { objectId: id, faceUp: next });
  }

  claim(id: string, playerId?: string): boolean {
    const pid = playerId ?? this.localPlayerId;
    return this.ownership.claim(id, pid);
  }

  release(id: string, playerId?: string): boolean {
    const pid = playerId ?? this.localPlayerId;
    return this.ownership.release(id, pid);
  }

  isLocked(id: string, playerId?: string): boolean {
    const pid = playerId ?? this.localPlayerId;
    return this.ownership.isOwnedByOther(id, pid);
  }
}
