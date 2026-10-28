import type { Quat, Transform, Vec3 } from '@chambler/shared';

export interface RemoteFrame {
  seq: number;
  t: number;
  pos: Vec3;
  rot: Quat;
  vel?: Vec3;
}

export interface InterpolatorOptions {
  /** Render delay in ms. */
  delayMs?: number;
  /** Position delta above which we snap instead of interpolate. */
  snapDistance?: number;
  /** Max buffered frames per object. */
  bufferSize?: number;
}

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
function cloneQuat(q: Quat): Quat {
  return { w: q.w, x: q.x, y: q.y, z: q.z };
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  // simple normalized lerp (good enough for small deltas)
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  const bb = { ...b };
  if (dot < 0) {
    bb.w = -bb.w;
    bb.x = -bb.x;
    bb.y = -bb.y;
    bb.z = -bb.z;
    dot = -dot;
  }
  const w = lerp(a.w, bb.w, t);
  const x = lerp(a.x, bb.x, t);
  const y = lerp(a.y, bb.y, t);
  const z = lerp(a.z, bb.z, t);
  const len = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
  return { w: w / len, x: x / len, y: y / len, z: z / len };
}

export class TransformInterpolator {
  private readonly delayMs: number;
  private readonly snapDistance: number;
  private readonly bufferSize: number;
  private readonly buffers = new Map<string, RemoteFrame[]>();

  constructor(opts: InterpolatorOptions = {}) {
    this.delayMs = opts.delayMs ?? 100;
    this.snapDistance = opts.snapDistance ?? 50;
    this.bufferSize = opts.bufferSize ?? 32;
  }

  push(id: string, frame: RemoteFrame): void {
    if (!this.buffers.has(id)) this.buffers.set(id, []);
    const buf = this.buffers.get(id)!;
    buf.push(frame);
    if (buf.length > this.bufferSize) buf.splice(0, buf.length - this.bufferSize);
    // keep sorted by t
    buf.sort((a, b) => a.t - b.t);
  }

  clear(id?: string): void {
    if (id) this.buffers.delete(id);
    else this.buffers.clear();
  }

  /**
   * B4: drops buffered frames for one object. Used after a tableResync —
   * the next sample returns null until fresh frames arrive, so the object
   * teleports to the resync transform instead of interpolating from
   * pre-disconnect frames (no snap/jump).
   */
  reset(objectId: string): void {
    this.buffers.delete(objectId);
  }

  /** B4: drops every buffered frame (see `reset`). */
  resetAll(): void {
    this.buffers.clear();
  }

  has(id: string): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0;
  }

  /** Returns interpolated transform for render time `now`, or null if no data. */
  sample(id: string, now: number): Transform | null {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return null;
    const target = now - this.delayMs;

    // If target is beyond latest, snap to latest.
    const latest = buf[buf.length - 1]!;
    if (target >= latest.t) {
      // extrapolate? keep latest
      return this.frameToTransform(latest);
    }
    // If target before earliest, snap to earliest.
    const earliest = buf[0]!;
    if (target <= earliest.t) {
      return this.frameToTransform(earliest);
    }
    // find surrounding frames
    let i = 0;
    for (; i < buf.length - 1; i++) {
      if (buf[i]!.t <= target && buf[i + 1]!.t >= target) break;
    }
    const a = buf[i]!;
    const b = buf[Math.min(i + 1, buf.length - 1)]!;
    if (a === b) return this.frameToTransform(a);

    // snap suppression
    if (dist(a.pos, b.pos) > this.snapDistance) {
      // snap to nearest by time
      return target - a.t < b.t - target
        ? this.frameToTransform(a)
        : this.frameToTransform(b);
    }

    const span = b.t - a.t;
    const alpha = span > 0 ? (target - a.t) / span : 0;
    const pos: Vec3 = {
      x: lerp(a.pos.x, b.pos.x, alpha),
      y: lerp(a.pos.y, b.pos.y, alpha),
      z: lerp(a.pos.z, b.pos.z, alpha),
    };
    const rot = slerp(a.rot, b.rot, alpha);
    return {
      position: pos,
      rotation: rot,
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  private frameToTransform(f: RemoteFrame): Transform {
    return {
      position: cloneVec(f.pos),
      rotation: cloneQuat(f.rot),
      scale: { x: 1, y: 1, z: 1 },
    };
  }
}
