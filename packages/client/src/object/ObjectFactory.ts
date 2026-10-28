import * as THREE from 'three';
import type { ObjectDef, Transform, Vec3 } from '@chambler/shared';
import { cloneTransform, IDENTITY_TRANSFORM } from '@chambler/shared';
import { specFor, halfExtents } from './ObjectSpec.js';
import type { CreateBodyOptions, ShapeDesc } from '../sim/PhysicsWorld.js';

export function createMesh(def: ObjectDef): THREE.Mesh {
  const spec = specFor(def);
  let geo: THREE.BufferGeometry;
  if (spec.shape === 'sphere') {
    geo = new THREE.SphereGeometry(spec.radius ?? 0.1, 16, 12);
  } else {
    geo = new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.55,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.objectId = def.id;
  applyTransform(mesh, def.transform);
  // die: procedural face dots? minimal: colored faces not required; keep simple.
  if (def.kind === 'die') {
    addDieDots(mesh, spec);
  }
  if (!def.faceUp && (def.kind === 'card' || def.kind === 'tile')) {
    mesh.rotation.x += Math.PI; // visual hint; real flip animated separately
  }
  return mesh;
}

function applyTransform(mesh: THREE.Object3D, t: Transform): void {
  mesh.position.set(t.position.x, t.position.y, t.position.z);
  mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
  mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

function addDieDots(mesh: THREE.Mesh, spec: { size: Vec3 }): void {
  // Procedural simple: colored dot on top face via a small sphere child.
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#222222' }),
  );
  dot.position.set(0, spec.size.y / 2 + 0.01, 0);
  mesh.add(dot);
}

export function createBodyOptions(def: ObjectDef, transform?: Transform): CreateBodyOptions {
  const spec = specFor(def);
  const t = transform ? cloneTransform(transform) : cloneTransform(def.transform);
  const shape: ShapeDesc =
    spec.shape === 'sphere'
      ? { kind: 'sphere', radius: spec.radius ?? 0.1 }
      : { kind: 'box', halfExtents: halfExtents(spec) };
  const opts: CreateBodyOptions = {
    type: def.locked ? 'fixed' : 'dynamic',
    shape,
    transform: t,
    mass: spec.mass > 0 ? spec.mass : undefined,
    canSleep: true,
    linearDamping: 0.1,
    angularDamping: 0.15,
  };
  return opts;
}

export { IDENTITY_TRANSFORM };
