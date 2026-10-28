/**
 * Binary transform codec (B3).
 *
 * ZERO runtime dependencies: plain TypeScript + DataView so the exact same
 * module runs in the browser, in Node and inside a worker.
 *
 * Wire layout — one packet carries 1..255 object frames:
 *
 * ```
 * offset  size  field
 * 0       1     packet type (TRANSFORM_PACKET_TYPE)
 * 1       1     record count (uint8)
 * 2       40*n  records
 * ```
 *
 * One record (TRANSFORM_RECORD_BYTES = 40):
 *
 * ```
 * +0   2   object index   uint16  (stable per room, see TransformIdTable)
 * +2   4   position.x     float32
 * +6   4   position.y     float32
 * +10  4   position.z     float32
 * +14  2   rotation.w     int16   (normalised quaternion, -1..1)
 * +16  2   rotation.x     int16
 * +18  2   rotation.y     int16
 * +20  2   rotation.z     int16
 * +22  4   velocity.x     float32
 * +26  4   velocity.y     float32
 * +30  4   velocity.z     float32
 * +34  2   seq            uint16  (per object, wraps; see isNewerSeq)
 * +36  4   t              uint32  (ms, wraps; see unwrapTimestamp)
 * ```
 *
 * The legacy JSON frame measured 271 bytes per object; this is 40 (+2 bytes of
 * packet header amortised over the whole batch).
 *
 * PRECISION / ROUNDTRIP TOLERANCES (documented contract, tested):
 * - position / velocity: stored as float32, so relative error <= 2^-23
 *   (~1.2e-7). At |x| <= 1000 that is <= 1.2e-4 m (0.12 mm).
 * - rotation: each component is quantised to int16 over [-1, 1], step
 *   1/32767, so the per-component error is <= 1/65534 (~1.53e-5). The
 *   resulting unit-quaternion angular error is <= ~6.2e-5 rad (~0.0036 deg).
 * - seq: uint16, compared with serial-number arithmetic so the wrap at 65535
 *   does not look like a stale frame.
 * - t: uint32 milliseconds; `unwrapTimestamp` maps it back to absolute epoch
 *   milliseconds for the interpolator.
 */

import type { Quat, Vec3 } from './types.js';

/** Packet type discriminator written in byte 0. */
export const TRANSFORM_PACKET_TYPE = 0x01;

/** Packet header: 1 byte type + 1 byte record count. */
export const TRANSFORM_HEADER_BYTES = 2;

/** Size of one encoded object frame. */
export const TRANSFORM_RECORD_BYTES = 40;

/** Hard cap of records in a single packet (count is a uint8). */
export const MAX_RECORDS_PER_PACKET = 255;

/** Default cap of object frames a client may put in one tick (see TransformSender). */
export const MAX_OBJECTS_PER_FRAME = 64;

/** Quantisation scale for quaternion components: q * 32767, clamped to int16. */
export const ROTATION_QUANT_SCALE = 32767;

/** Serial-number half range, used for uint16 seq comparison. */
const SEQ_HALF_RANGE = 0x8000;
const SEQ_MASK = 0xffff;
const TIME_RANGE = 0x100000000;
const TIME_HALF_RANGE = 0x80000000;

export type TransformCodecErrorCode =
  | 'EMPTY_BATCH'
  | 'TOO_MANY_RECORDS'
  | 'BAD_PACKET_TYPE'
  | 'TRUNCATED_PACKET'
  | 'BAD_RECORD_COUNT'
  | 'ID_TABLE_FULL'
  | 'INDEX_CONFLICT';

export class TransformCodecError extends Error {
  readonly code: TransformCodecErrorCode;

  constructor(code: TransformCodecErrorCode, message: string) {
    super(message);
    this.name = 'TransformCodecError';
    this.code = code;
  }
}

/** One object frame as it appears on the wire (index instead of string id). */
export interface WireTransformFrame {
  /** Stable object index from the room's TransformIdTable. */
  index: number;
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  /** Per-object monotonic sequence (uint16, wraps). */
  seq: number;
  /** Sender timestamp in ms (uint32, wraps). */
  t: number;
}

export interface DecodedTransformBatch {
  /** Packet type byte (always TRANSFORM_PACKET_TYPE for a valid packet). */
  type: number;
  frames: WireTransformFrame[];
  /** Exact number of bytes consumed. */
  bytes: number;
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clampInt16(value: number): number {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value;
}

/** Returns a unit quaternion; a degenerate input yields identity. */
export function normalizeQuat(q: Partial<Quat> | null | undefined): Quat {
  const w = finite(q?.w);
  const x = finite(q?.x);
  const y = finite(q?.y);
  const z = finite(q?.z);
  const len = Math.sqrt(w * w + x * x + y * y + z * z);
  if (!(len > 1e-9)) {
    return { w: 1, x: 0, y: 0, z: 0 };
  }
  return { w: w / len, x: x / len, y: y / len, z: z / len };
}

/** Quantises a quaternion into four int16 components over [-1, 1]. */
export function quantizeQuat(q: Partial<Quat> | null | undefined): [number, number, number, number] {
  const n = normalizeQuat(q);
  const scale = ROTATION_QUANT_SCALE;
  return [
    clampInt16(Math.round(n.w * scale)),
    clampInt16(Math.round(n.x * scale)),
    clampInt16(Math.round(n.y * scale)),
    clampInt16(Math.round(n.z * scale)),
  ];
}

/** Inverse of `quantizeQuat`; the result is re-normalised to unit length. */
export function dequantizeQuat(w: number, x: number, y: number, z: number): Quat {
  const scale = ROTATION_QUANT_SCALE;
  return normalizeQuat({ w: w / scale, x: x / scale, y: y / scale, z: z / scale });
}

/** Number of bytes a packet with `count` records occupies. */
export function transformBatchByteLength(count: number): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new TransformCodecError('BAD_RECORD_COUNT', `count must be a non-negative integer, got ${count}`);
  }
  return TRANSFORM_HEADER_BYTES + count * TRANSFORM_RECORD_BYTES;
}

/**
 * Encodes a batch. `into` may be a reusable scratch buffer; a subarray of it is
 * returned when it is large enough, otherwise a fresh array is allocated.
 */
export function encodeTransformBatch(
  frames: readonly WireTransformFrame[],
  into?: Uint8Array,
): Uint8Array {
  const count = frames.length;
  if (count === 0) {
    throw new TransformCodecError('EMPTY_BATCH', 'cannot encode an empty transform batch');
  }
  if (count > MAX_RECORDS_PER_PACKET) {
    throw new TransformCodecError(
      'TOO_MANY_RECORDS',
      `a packet carries at most ${MAX_RECORDS_PER_PACKET} records, got ${count}`,
    );
  }

  const size = transformBatchByteLength(count);
  const buffer = into && into.byteLength >= size ? into.subarray(0, size) : new Uint8Array(size);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  view.setUint8(0, TRANSFORM_PACKET_TYPE);
  view.setUint8(1, count);

  let offset = TRANSFORM_HEADER_BYTES;
  for (const frame of frames) {
    const index = frame.index;
    if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
      throw new TransformCodecError('ID_TABLE_FULL', `object index out of uint16 range: ${index}`);
    }
    const position = frame.position;
    const velocity = frame.velocity;
    const rotation = quantizeQuat(frame.rotation);

    view.setUint16(offset, index);
    view.setFloat32(offset + 2, finite(position?.x), true);
    view.setFloat32(offset + 6, finite(position?.y), true);
    view.setFloat32(offset + 10, finite(position?.z), true);
    view.setInt16(offset + 14, rotation[0], true);
    view.setInt16(offset + 16, rotation[1], true);
    view.setInt16(offset + 18, rotation[2], true);
    view.setInt16(offset + 20, rotation[3], true);
    view.setFloat32(offset + 22, finite(velocity?.x), true);
    view.setFloat32(offset + 26, finite(velocity?.y), true);
    view.setFloat32(offset + 30, finite(velocity?.z), true);
    view.setUint16(offset + 34, Math.round(finite(frame.seq)) & SEQ_MASK);
    view.setUint32(offset + 36, Math.round(finite(frame.t)) >>> 0, true);
    offset += TRANSFORM_RECORD_BYTES;
  }

  return buffer;
}

/** Decodes a packet. Throws `TransformCodecError` for malformed input. */
export function decodeTransformBatch(bytes: Uint8Array | ArrayBuffer): DecodedTransformBatch {
  const view =
    bytes instanceof ArrayBuffer
      ? new DataView(bytes)
      : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.byteLength;
  if (length < TRANSFORM_HEADER_BYTES) {
    throw new TransformCodecError('TRUNCATED_PACKET', `packet is ${length} bytes, header needs 2`);
  }
  const type = view.getUint8(0);
  if (type !== TRANSFORM_PACKET_TYPE) {
    throw new TransformCodecError('BAD_PACKET_TYPE', `unexpected packet type 0x${type.toString(16)}`);
  }
  const count = view.getUint8(1);
  if (count === 0) {
    throw new TransformCodecError('BAD_RECORD_COUNT', 'packet declares 0 records');
  }
  const expected = transformBatchByteLength(count);
  if (length < expected) {
    throw new TransformCodecError(
      'TRUNCATED_PACKET',
      `packet declares ${count} records (${expected} bytes) but only ${length} bytes arrived`,
    );
  }

  const frames: WireTransformFrame[] = new Array(count);
  let offset = TRANSFORM_HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    frames[i] = {
      index: view.getUint16(offset),
      position: {
        x: view.getFloat32(offset + 2, true),
        y: view.getFloat32(offset + 6, true),
        z: view.getFloat32(offset + 10, true),
      },
      rotation: dequantizeQuat(
        view.getInt16(offset + 14, true),
        view.getInt16(offset + 16, true),
        view.getInt16(offset + 18, true),
        view.getInt16(offset + 20, true),
      ),
      velocity: {
        x: view.getFloat32(offset + 22, true),
        y: view.getFloat32(offset + 26, true),
        z: view.getFloat32(offset + 30, true),
      },
      seq: view.getUint16(offset + 34),
      t: view.getUint32(offset + 36, true),
    };
    offset += TRANSFORM_RECORD_BYTES;
  }

  return { type, frames, bytes: expected };
}

/**
 * Serial-number comparison for uint16 sequence numbers: true when `a` is newer
 * than `b`, including across the 65535 -> 0 wrap.
 */
export function isNewerSeq(a: number, b: number): boolean {
  const delta = (Math.round(a) - Math.round(b)) & SEQ_MASK;
  return delta !== 0 && delta < SEQ_HALF_RANGE;
}

/** uint32 wire timestamp for an absolute epoch-millisecond value. */
export function toWireTimestamp(t: number): number {
  return Math.round(finite(t)) >>> 0;
}

/**
 * Maps a uint32 wire timestamp back to absolute epoch milliseconds, choosing the
 * 2^32 window closest to `now` (so a packet sent just before a wrap is still
 * interpreted as "just now").
 */
export function unwrapTimestamp(wire: number, now: number = Date.now()): number {
  const base = Math.floor(now / TIME_RANGE) * TIME_RANGE;
  let t = base + (Math.round(finite(wire)) >>> 0);
  if (t - now > TIME_HALF_RANGE) t -= TIME_RANGE;
  else if (now - t > TIME_HALF_RANGE) t += TIME_RANGE;
  return t;
}

/**
 * Persistent string-id <-> uint16 index table.
 *
 * Indices are assigned once and never reused while the table lives (a room
 * lifetime), so a client and the server agree on the meaning of every index
 * even for objects that were spawned long ago. `assign` lets a client adopt the
 * server-assigned index carried by `ObjectDef.netIndex`.
 */
export class TransformIdTable {
  private readonly indexById = new Map<string, number>();
  private readonly idByIndex: Array<string | undefined> = [];
  private nextIndex = 0;

  /** Returns the index for `id`, assigning a fresh one when unseen. */
  indexOf(id: string): number {
    const existing = this.indexById.get(id);
    if (existing !== undefined) return existing;
    if (this.nextIndex > 0xffff) {
      throw new TransformCodecError('ID_TABLE_FULL', 'transform id table exhausted (65536 objects)');
    }
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.indexById.set(id, index);
    this.idByIndex[index] = id;
    return index;
  }

  /** Adopts a known index (server-assigned). Throws when it is already taken. */
  assign(id: string, index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
      throw new TransformCodecError('ID_TABLE_FULL', `index out of uint16 range: ${index}`);
    }
    const current = this.indexById.get(id);
    if (current === index) return;
    if (current !== undefined) {
      throw new TransformCodecError('INDEX_CONFLICT', `object ${id} already has index ${current}`);
    }
    const occupant = this.idByIndex[index];
    if (occupant !== undefined && occupant !== id) {
      throw new TransformCodecError('INDEX_CONFLICT', `index ${index} already belongs to ${occupant}`);
    }
    this.indexById.set(id, index);
    this.idByIndex[index] = id;
    if (index >= this.nextIndex) this.nextIndex = index + 1;
  }

  idOf(index: number): string | undefined {
    return this.idByIndex[index];
  }

  has(id: string): boolean {
    return this.indexById.has(id);
  }

  delete(id: string): void {
    const index = this.indexById.get(id);
    if (index === undefined) return;
    this.indexById.delete(id);
    this.idByIndex[index] = undefined;
  }

  clear(): void {
    this.indexById.clear();
    this.idByIndex.length = 0;
    this.nextIndex = 0;
  }

  get size(): number {
    return this.indexById.size;
  }

  /** Copy of the id -> index mapping (debugging / handoff). */
  entries(): Array<[string, number]> {
    return [...this.indexById.entries()];
  }
}

/**
 * Angle in degrees between two unit quaternions (used by the motion filter).
 * Both quaternions must be normalised; the result is in [0, 180].
 */
export function quatAngleDegrees(a: Quat, b: Quat): number {
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  const clamped = dot > 1 ? 1 : dot;
  return (2 * Math.acos(clamped) * 180) / Math.PI;
}

/** Euclidean distance between two points. */
export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
