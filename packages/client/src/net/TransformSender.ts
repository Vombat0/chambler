/**
 * Motion-gated transform sender (B3).
 *
 * Turns a stream of local object transforms (potentially one per object per
 * render frame) into a small number of binary batches:
 *
 * - A still object costs nothing: while the position delta is below 0.5 mm and
 *   the rotation delta below 0.1 deg, no frame is queued. When an object comes
 *   to rest exactly one final "stop" frame (zero velocity) is sent, so remote
 *   clients land on the exact pose.
 * - A moving object is sampled at 20 Hz when it is fast, 5 Hz when it is slow,
 *   so slow drifts do not burn the same budget as a thrown die.
 * - Every flush sends at most `maxObjectsPerFrame` objects. Anything above the
 *   budget stays queued for the next flush; when the queue overflows the OLDEST
 *   frame is dropped, because newer data supersedes it.
 *
 * The module is dependency-free (only @chambler/shared) so it can be unit
 * tested, imported by the render loop and reused by the bandwidth script.
 */
import {
  TRANSFORM_FAST_ANGULAR_DPS,
  TRANSFORM_FAST_INTERVAL_MS,
  TRANSFORM_FAST_SPEED_MPS,
  TRANSFORM_MOTION_EPSILON_DEG,
  TRANSFORM_MOTION_EPSILON_M,
  TRANSFORM_SLOW_INTERVAL_MS,
  MAX_OBJECTS_PER_FRAME,
  TransformIdTable,
  distance3,
  encodeTransformBatch,
  normalizeQuat,
  quatAngleDegrees,
  toWireTimestamp,
  type Quat,
  type Transform,
  type Vec3,
  type WireTransformFrame,
} from '@chambler/shared';

export interface TransformSenderOptions {
  /** Object frames per flush (default 64). */
  maxObjectsPerFrame?: number;
  /** Interval used while moving fast (default 50 ms = 20 Hz). */
  fastIntervalMs?: number;
  /** Interval used while moving slowly / settling (default 200 ms = 5 Hz). */
  slowIntervalMs?: number;
  /** Position delta under which the object is considered still (metres). */
  positionEpsilon?: number;
  /** Rotation delta under which the object is considered still (degrees). */
  rotationEpsilonDeg?: number;
  /** Linear speed above which the fast interval is used (m/s). */
  fastSpeed?: number;
  /** Angular speed above which the fast interval is used (deg/s). */
  fastAngularSpeed?: number;
  /** Max objects waiting in the send queue before the oldest is dropped. */
  maxQueue?: number;
  /** Shared id table (must be the same one the receiver uses). */
  idTable?: TransformIdTable;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface TransformSenderStats {
  framesSent: number;
  batchesSent: number;
  bytesSent: number;
  /** Samples skipped because the object did not move. */
  framesSuppressed: number;
  /** Samples replaced/evicted because a newer one existed or the queue was full. */
  framesDropped: number;
  /** Objects that had to wait for a later flush because of the per-frame budget. */
  framesDeferred: number;
  stopFrames: number;
}

export interface QueuedTransform {
  id: string;
  index: number;
  transform: Transform;
  velocity: Vec3;
  /** Time the sample was taken (ms). */
  sampledAt: number;
}

interface PendingSample {
  id: string;
  index: number;
  transform: Transform;
  velocity: Vec3;
  sampledAt: number;
}

interface ObjectSendState {
  lastPosition: Vec3 | null;
  lastRotation: Quat | null;
  lastSentAt: number;
  lastVelocity: Vec3 | null;
  seq: number;
  moving: boolean;
  pending: PendingSample | null;
  dueAt: number;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function cloneVec(v: Vec3 | undefined): Vec3 {
  return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 };
}

function speedOf(velocity: Vec3 | undefined): number {
  return Math.hypot(velocity?.x ?? 0, velocity?.y ?? 0, velocity?.z ?? 0);
}

export class TransformSender {
  readonly idTable: TransformIdTable;
  readonly stats: TransformSenderStats = {
    framesSent: 0,
    batchesSent: 0,
    bytesSent: 0,
    framesSuppressed: 0,
    framesDropped: 0,
    framesDeferred: 0,
    stopFrames: 0,
  };

  private readonly maxObjectsPerFrame: number;
  private readonly fastIntervalMs: number;
  private readonly slowIntervalMs: number;
  private readonly positionEpsilon: number;
  private readonly rotationEpsilonDeg: number;
  private readonly fastSpeed: number;
  private readonly fastAngularSpeed: number;
  private readonly maxQueue: number;
  private readonly now: () => number;
  private readonly states = new Map<string, ObjectSendState>();
  /** Ready-to-send samples, oldest first (Map keeps insertion order). */
  private readonly ready = new Map<string, PendingSample>();
  private scratch: Uint8Array | null = null;

  constructor(opts: TransformSenderOptions = {}) {
    this.idTable = opts.idTable ?? new TransformIdTable();
    this.maxObjectsPerFrame = Math.max(1, opts.maxObjectsPerFrame ?? MAX_OBJECTS_PER_FRAME);
    this.fastIntervalMs = Math.max(1, opts.fastIntervalMs ?? TRANSFORM_FAST_INTERVAL_MS);
    this.slowIntervalMs = Math.max(this.fastIntervalMs, opts.slowIntervalMs ?? TRANSFORM_SLOW_INTERVAL_MS);
    this.positionEpsilon = opts.positionEpsilon ?? TRANSFORM_MOTION_EPSILON_M;
    this.rotationEpsilonDeg = opts.rotationEpsilonDeg ?? TRANSFORM_MOTION_EPSILON_DEG;
    this.fastSpeed = opts.fastSpeed ?? TRANSFORM_FAST_SPEED_MPS;
    this.fastAngularSpeed = opts.fastAngularSpeed ?? TRANSFORM_FAST_ANGULAR_DPS;
    this.maxQueue = Math.max(1, opts.maxQueue ?? this.maxObjectsPerFrame * 4);
    this.now = opts.now ?? (() => Date.now());
  }

  /** Adopts a server-assigned wire index for an object. */
  registerIndex(id: string, index: number): void {
    this.idTable.assign(id, index);
  }

  /**
   * Offers a local transform. Returns true when a frame was queued for the next
   * flush, false when the sample was filtered (still) or rate-limited.
   */
  enqueue(
    id: string,
    transform: Transform,
    velocity?: Vec3,
    now: number = this.now(),
  ): boolean {
    const state = this.stateOf(id);
    const index = this.idTable.indexOf(id);
    const rotation = normalizeQuat(transform.rotation);
    const position = cloneVec(transform.position);

    const still = this.isStill(state, position, rotation);
    if (still) {
      state.pending = null;
      // A stop frame is only useful when receivers believe the object moves.
      if (state.moving && speedOf(state.lastVelocity ?? undefined) > 0.001) {
        // One last frame so receivers land exactly on the resting pose.
        state.moving = false;
        this.pushReady({
          id,
          index,
          transform: { position, rotation, scale: transform.scale ?? { x: 1, y: 1, z: 1 } },
          velocity: ZERO,
          sampledAt: now,
        });
        this.stats.stopFrames += 1;
        return true;
      }
      this.stats.framesSuppressed += 1;
      return false;
    }

    const interval = this.intervalFor(state, position, rotation, velocity, now);
    if (now - state.lastSentAt < interval) {
      if (state.pending) this.stats.framesDropped += 1; // newer sample wins
      state.pending = {
        id,
        index,
        transform: { position, rotation, scale: transform.scale ?? { x: 1, y: 1, z: 1 } },
        velocity: cloneVec(velocity),
        sampledAt: now,
      };
      state.dueAt = state.lastSentAt + interval;
      state.moving = true;
      return false;
    }

    state.pending = null;
    state.moving = true;
    this.pushReady({
      id,
      index,
      transform: { position, rotation, scale: transform.scale ?? { x: 1, y: 1, z: 1 } },
      velocity: cloneVec(velocity),
      sampledAt: now,
    });
    return true;
  }

  /**
   * Promotes due samples and encodes at most `maxObjectsPerFrame` objects.
   * Returns the batches to send (one packet per call, more when the queue holds
   * more than the per-frame budget and the caller flushes again).
   */
  flush(now: number = this.now()): Uint8Array[] {
    for (const state of this.states.values()) {
      const pending = state.pending;
      if (!pending) continue;
      if (now < state.dueAt) continue;
      state.pending = null;
      this.pushReady(pending);
    }

    if (this.ready.size === 0) return [];

    const frames: WireTransformFrame[] = [];
    const taken: string[] = [];
    for (const [id, sample] of this.ready) {
      if (frames.length >= this.maxObjectsPerFrame) break;
      const state = this.stateOf(id);
      state.seq = (state.seq + 1) & 0xffff;
      frames.push({
        index: sample.index,
        position: sample.transform.position,
        rotation: sample.transform.rotation,
        velocity: sample.velocity,
        seq: state.seq,
        t: toWireTimestamp(sample.sampledAt),
      });
      state.lastPosition = cloneVec(sample.transform.position);
      state.lastRotation = sample.transform.rotation;
      state.lastVelocity = cloneVec(sample.velocity);
      state.lastSentAt = sample.sampledAt;
      taken.push(id);
    }
    for (const id of taken) this.ready.delete(id);
    if (frames.length === 0) return [];
    if (this.ready.size > 0) this.stats.framesDeferred += this.ready.size;

    const bytes = encodeTransformBatch(frames, this.scratch ?? undefined);
    if (this.scratch === null || this.scratch.byteLength < bytes.byteLength) {
      this.scratch = new Uint8Array(Math.max(bytes.byteLength, 2 + this.maxObjectsPerFrame * 40));
    }
    this.stats.framesSent += frames.length;
    this.stats.batchesSent += 1;
    this.stats.bytesSent += bytes.byteLength;
    return [bytes];
  }

  /** Flush and hand every packet to `send`; returns the number of frames sent. */
  flushTo(now: number, send: (bytes: Uint8Array) => void): number {
    let sent = 0;
    for (const packet of this.flush(now)) {
      send(packet);
      sent += (packet[1] ?? 0) as number;
    }
    return sent;
  }

  /** Objects waiting in the send queue (not counting rate-limited samples). */
  get queueSize(): number {
    return this.ready.size;
  }

  hasPending(): boolean {
    return this.ready.size > 0;
  }

  /** Drops all queued data for one object (e.g. on release/remove). */
  forget(id: string): void {
    this.states.delete(id);
    this.ready.delete(id);
  }

  reset(): void {
    this.states.clear();
    this.ready.clear();
    this.scratch = null;
  }

  /** Snapshot of the queue, oldest first (tests / debugging). */
  queued(): QueuedTransform[] {
    return [...this.ready.values()].map((sample) => ({
      id: sample.id,
      index: sample.index,
      transform: sample.transform,
      velocity: sample.velocity,
      sampledAt: sample.sampledAt,
    }));
  }

  private stateOf(id: string): ObjectSendState {
    let state = this.states.get(id);
    if (!state) {
      state = {
        lastPosition: null,
        lastRotation: null,
        lastSentAt: Number.NEGATIVE_INFINITY,
        lastVelocity: null,
        seq: 0,
        moving: false,
        pending: null,
        dueAt: 0,
      };
      this.states.set(id, state);
    }
    return state;
  }

  private isStill(state: ObjectSendState, position: Vec3, rotation: Quat): boolean {
    if (!state.lastPosition || !state.lastRotation) return false; // first sample always goes out
    const moved = distance3(state.lastPosition, position);
    const turned = quatAngleDegrees(state.lastRotation, rotation);
    return moved < this.positionEpsilon && turned < this.rotationEpsilonDeg;
  }

  private intervalFor(
    state: ObjectSendState,
    position: Vec3,
    rotation: Quat,
    velocity: Vec3 | undefined,
    now: number,
  ): number {
    const dt = Math.max(1, now - state.lastSentAt) / 1000;
    const linear = Math.max(speedOf(velocity), state.lastPosition ? distance3(state.lastPosition, position) / dt : 0);
    const angular = state.lastRotation ? quatAngleDegrees(state.lastRotation, rotation) / dt : 0;
    const fast = linear >= this.fastSpeed || angular >= this.fastAngularSpeed;
    return fast ? this.fastIntervalMs : this.slowIntervalMs;
  }

  private pushReady(sample: PendingSample): void {
    if (this.ready.has(sample.id)) {
      this.ready.delete(sample.id);
      this.stats.framesDropped += 1;
    }
    while (this.ready.size >= this.maxQueue) {
      const oldest = this.ready.keys().next();
      if (oldest.done) break;
      this.ready.delete(oldest.value);
      this.stats.framesDropped += 1;
    }
    this.ready.set(sample.id, sample);
  }
}
