import * as RAPIER from '@dimforge/rapier3d-compat';
import type { Transform, Vec3 } from '@chambler/shared';
import { rapierToTransform } from './transforms.js';

export const PHYSICS_HZ = 60;
export const FIXED_DT = 1 / PHYSICS_HZ;

export type BodyType = 'dynamic' | 'fixed' | 'kinematic';

export interface BoxShape {
  kind: 'box';
  halfExtents: Vec3;
}

export interface SphereShape {
  kind: 'sphere';
  radius: number;
}

export type ShapeDesc = BoxShape | SphereShape;

export interface CreateBodyOptions {
  type: BodyType;
  shape: ShapeDesc;
  transform: Transform;
  mass?: number;
  canSleep?: boolean;
  linearDamping?: number;
  angularDamping?: number;
}

export interface PhysicsBody {
  id: string;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  private readonly bodies = new Map<string, PhysicsBody>();
  private accumulator = 0;
  lastSteps = 0;

  private constructor(public readonly world: RAPIER.World) {}

  static async create(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World(gravity);
    world.timestep = FIXED_DT;
    return new PhysicsWorld(world);
  }

  createBody(id: string, opts: CreateBodyOptions): PhysicsBody {
    const desc =
      opts.type === 'dynamic'
        ? RAPIER.RigidBodyDesc.dynamic()
        : opts.type === 'fixed'
          ? RAPIER.RigidBodyDesc.fixed()
          : RAPIER.RigidBodyDesc.kinematicPositionBased();

    desc.setTranslation(
      opts.transform.position.x,
      opts.transform.position.y,
      opts.transform.position.z,
    );
    desc.setRotation({
      x: opts.transform.rotation.x,
      y: opts.transform.rotation.y,
      z: opts.transform.rotation.z,
      w: opts.transform.rotation.w,
    });
    if (opts.mass !== undefined) desc.mass = opts.mass;
    desc.canSleep = opts.canSleep ?? true;
    if (opts.linearDamping !== undefined) desc.linearDamping = opts.linearDamping;
    if (opts.angularDamping !== undefined) desc.angularDamping = opts.angularDamping;

    const rigidBody = this.world.createRigidBody(desc);
    const colliderDesc =
      opts.shape.kind === 'box'
        ? RAPIER.ColliderDesc.cuboid(
            opts.shape.halfExtents.x,
            opts.shape.halfExtents.y,
            opts.shape.halfExtents.z,
          )
        : RAPIER.ColliderDesc.ball(opts.shape.radius);
    const collider = this.world.createCollider(colliderDesc, rigidBody);

    const body: PhysicsBody = { id, rigidBody, collider };
    this.bodies.set(id, body);
    return body;
  }

  removeBody(id: string): void {
    const body = this.bodies.get(id);
    if (!body) return;
    this.world.removeRigidBody(body.rigidBody);
    this.bodies.delete(id);
  }

  getBody(id: string): PhysicsBody | undefined {
    return this.bodies.get(id);
  }

  hasBody(id: string): boolean {
    return this.bodies.has(id);
  }

  listBodies(): PhysicsBody[] {
    return Array.from(this.bodies.values());
  }

  bodyCount(): number {
    return this.bodies.size;
  }

  /** Advance simulation. Returns interpolation alpha in [0,1). */
  step(deltaSeconds?: number): number {
    const dt = deltaSeconds ?? FIXED_DT;
    this.accumulator += dt;
    let steps = 0;
    const maxSteps = 5;
    while (this.accumulator >= FIXED_DT && steps < maxSteps) {
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === maxSteps && this.accumulator >= FIXED_DT) {
      this.accumulator = 0;
    }
    this.lastSteps = steps;
    return this.accumulator / FIXED_DT;
  }

  readTransform(body: PhysicsBody): Transform {
    return rapierToTransform(body.rigidBody.translation(), body.rigidBody.rotation());
  }

  dispose(): void {
    this.bodies.clear();
    this.world.free();
  }
}