import * as THREE from 'three';
import type { Transform } from '@chambler/shared';

export function rapierToTransform(
  pos: { x: number; y: number; z: number },
  rot: { x: number; y: number; z: number; w: number },
): Transform {
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { w: rot.w, x: rot.x, y: rot.y, z: rot.z },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function applyTransformToMesh(mesh: THREE.Object3D, t: Transform): void {
  mesh.position.set(t.position.x, t.position.y, t.position.z);
  mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
  mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

export function cloneTransform(t: Transform): Transform {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}

export function lerpTransform(a: Transform, b: Transform, alpha: number): Transform {
  const qA = new THREE.Quaternion(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w);
  const qB = new THREE.Quaternion(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
  const q = qA.slerp(qB, alpha);
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * alpha,
      y: a.position.y + (b.position.y - a.position.y) * alpha,
      z: a.position.z + (b.position.z - a.position.z) * alpha,
    },
    rotation: { w: q.w, x: q.x, y: q.y, z: q.z },
    scale: {
      x: a.scale.x + (b.scale.x - a.scale.x) * alpha,
      y: a.scale.y + (b.scale.y - a.scale.y) * alpha,
      z: a.scale.z + (b.scale.z - a.scale.z) * alpha,
    },
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}