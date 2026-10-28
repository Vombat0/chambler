import type { Quat } from '@chambler/shared';

// Local-space face normals for a box die, mapped to face values.
// Opposite faces sum to 7.
const FACE_NORMALS: Array<{ normal: [number, number, number]; value: number }> = [
  { normal: [0, 1, 0], value: 1 },
  { normal: [0, -1, 0], value: 6 },
  { normal: [1, 0, 0], value: 2 },
  { normal: [-1, 0, 0], value: 5 },
  { normal: [0, 0, 1], value: 3 },
  { normal: [0, 0, -1], value: 4 },
];

function rotateVec(q: Quat, v: [number, number, number]): [number, number, number] {
  // v' = q * v * q^-1  (q is unit)
  const { x, y, z, w } = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  // v' = v + w*t + cross(q.xyz, t)
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Read top face value of a d6 given its orientation quaternion (shared w-first). */
export function readDieFace(q: Quat): number {
  let bestValue = 1;
  let bestDot = -Infinity;
  for (const f of FACE_NORMALS) {
    const n = rotateVec(q, f.normal);
    const dot = n[1]; // world up is +Y
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = f.value;
    }
  }
  return bestValue;
}

/** Quaternions for each face landing on top (for tests). */
export function quaternionForTopFace(value: number): Quat {
  // Find the normal that should point up (world +Y) for given value.
  const entry = FACE_NORMALS.find((f) => f.value === value)!;
  const n = entry.normal;
  // Rotation taking n to +Y.
  // Use simple axis-angle.
  if (n[0] === 0 && n[1] === 1 && n[2] === 0) return { w: 1, x: 0, y: 0, z: 0 };
  if (n[0] === 0 && n[1] === -1 && n[2] === 0) return { w: 0, x: 1, y: 0, z: 0 }; // 180 around X
  // General: rotate around axis perpendicular to n and Y.
  // cross(n, Y) = (n.z*1 - 0, 0 - n.x*1, n.x*0 - n.z*0)? let's compute cross(n, up): (n.y*up.z - n.z*up.y, n.z*up.x - n.x*up.z, n.x*up.y - n.y*up.x) = (0 - n.z, 0 - 0? wait)
  // up = (0,1,0). cross(n, up) = (n.y*0 - n.z*1, n.z*0 - n.x*0, n.x*1 - n.y*0) = (-n.z, 0, n.x)
  const ax = -n[2];
  const az = n[0];
  const len = Math.hypot(ax, az);
  if (len === 0) return { w: 1, x: 0, y: 0, z: 0 };
  const ux = ax / len;
  const uz = az / len;
  const dot = n[1]; // n·up
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const hw = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);
  return { w: hw, x: ux * s, y: 0, z: uz * s };
}
