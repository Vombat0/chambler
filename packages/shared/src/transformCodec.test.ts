import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from './types.js';
import {
  MAX_RECORDS_PER_PACKET,
  ROTATION_QUANT_SCALE,
  TRANSFORM_HEADER_BYTES,
  TRANSFORM_PACKET_TYPE,
  TRANSFORM_RECORD_BYTES,
  TransformCodecError,
  TransformIdTable,
  decodeTransformBatch,
  dequantizeQuat,
  distance3,
  encodeTransformBatch,
  isNewerSeq,
  normalizeQuat,
  quantizeQuat,
  quatAngleDegrees,
  toWireTimestamp,
  transformBatchByteLength,
  unwrapTimestamp,
  type WireTransformFrame,
} from './transformCodec.js';

/* Tolerances documented in transformCodec.ts */
const POSITION_TOLERANCE_M = 1e-4; // float32 at |x| <= 1000 is ~1.2e-4 worst case
const VELOCITY_TOLERANCE = 1e-4;
const ROTATION_COMPONENT_TOLERANCE = 2 / 65534; // int16 step, generous
const ROTATION_ANGLE_TOLERANCE_DEG = 0.01;

function frame(overrides: Partial<WireTransformFrame> = {}): WireTransformFrame {
  return {
    index: 3,
    position: { x: 1.5, y: 0.25, z: -2.75 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    velocity: { x: 0.5, y: 0, z: -0.5 },
    seq: 42,
    t: 1_700_000_000_123,
    ...overrides,
  };
}

function expectVecClose(actual: Vec3, expected: Vec3, tolerance: number): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tolerance);
}

describe('transformCodec — packet layout', () => {
  it('is exactly 2 + 40 bytes per object (vs 271 bytes of JSON)', () => {
    expect(TRANSFORM_RECORD_BYTES).toBe(40);
    expect(transformBatchByteLength(1)).toBe(42);
    expect(transformBatchByteLength(20)).toBe(2 + 20 * 40);
    expect(transformBatchByteLength(64)).toBe(2 + 64 * 40);
  });

  it('writes the packet type byte first and the record count second', () => {
    const bytes = encodeTransformBatch([frame(), frame({ index: 4 })]);
    expect(bytes[0]).toBe(TRANSFORM_PACKET_TYPE);
    expect(bytes[1]).toBe(2);
    expect(bytes.byteLength).toBe(TRANSFORM_HEADER_BYTES + 2 * TRANSFORM_RECORD_BYTES);
  });

  it('reuses the scratch buffer when it is large enough', () => {
    const scratch = new Uint8Array(256);
    const bytes = encodeTransformBatch([frame()], scratch);
    expect(bytes.buffer).toBe(scratch.buffer);
    expect(bytes.byteLength).toBe(42);
  });

  it('refuses an empty batch', () => {
    expect(() => encodeTransformBatch([])).toThrow(TransformCodecError);
    try {
      encodeTransformBatch([]);
    } catch (error) {
      expect((error as TransformCodecError).code).toBe('EMPTY_BATCH');
    }
  });

  it('refuses more than 255 records in one packet', () => {
    const frames = Array.from({ length: MAX_RECORDS_PER_PACKET + 1 }, (_, i) => frame({ index: i }));
    expect(() => encodeTransformBatch(frames)).toThrow(/at most 255/);
  });

  it('rejects a truncated packet', () => {
    const bytes = encodeTransformBatch([frame(), frame({ index: 9 })]);
    expect(() => decodeTransformBatch(bytes.subarray(0, bytes.byteLength - 5))).toThrow(/only/);
  });

  it('rejects an unknown packet type', () => {
    const bytes = encodeTransformBatch([frame()]);
    bytes[0] = 0x7f;
    try {
      decodeTransformBatch(bytes);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TransformCodecError).code).toBe('BAD_PACKET_TYPE');
    }
  });

  it('rejects a header-only packet claiming zero records', () => {
    const bytes = new Uint8Array([TRANSFORM_PACKET_TYPE, 0]);
    expect(() => decodeTransformBatch(bytes)).toThrow(/0 records/);
  });
});

describe('transformCodec — roundtrip', () => {
  it('roundtrips a single frame within the documented tolerances', () => {
    const original = frame();
    const decoded = decodeTransformBatch(encodeTransformBatch([original]));
    expect(decoded.frames).toHaveLength(1);
    const got = decoded.frames[0]!;
    expect(got.index).toBe(original.index);
    expect(got.seq).toBe(original.seq);
    // t is a uint32 on the wire; the receiver restores the absolute value.
    expect(got.t).toBe(toWireTimestamp(original.t));
    expect(unwrapTimestamp(got.t, original.t)).toBe(original.t);
    expectVecClose(got.position, original.position, POSITION_TOLERANCE_M);
    expectVecClose(got.velocity, original.velocity, VELOCITY_TOLERANCE);
    expect(quatAngleDegrees(got.rotation, original.rotation)).toBeLessThanOrEqual(
      ROTATION_ANGLE_TOLERANCE_DEG,
    );
  });

  it('roundtrips a 64-object batch and keeps frame order', () => {
    const frames = Array.from({ length: 64 }, (_, i) =>
      frame({ index: i * 7, seq: i, position: { x: i, y: i / 2, z: -i } }),
    );
    const decoded = decodeTransformBatch(encodeTransformBatch(frames));
    expect(decoded.frames).toHaveLength(64);
    for (let i = 0; i < 64; i += 1) {
      expect(decoded.frames[i]!.index).toBe(i * 7);
      expect(decoded.frames[i]!.seq).toBe(i);
      expectVecClose(decoded.frames[i]!.position, frames[i]!.position, POSITION_TOLERANCE_M);
    }
  });

  it('roundtrips extreme positions and keeps float32 precision', () => {
    const extremes: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: -1000, y: 1000, z: -0.0001 },
      { x: 12345.678, y: -9876.543, z: 1e-7 },
      { x: 1e6, y: -1e6, z: 3.4028235e38 },
    ];
    const frames = extremes.map((position, i) => frame({ index: i, position }));
    const decoded = decodeTransformBatch(encodeTransformBatch(frames));
    for (let i = 0; i < extremes.length; i += 1) {
      const expected = extremes[i]!;
      const got = decoded.frames[i]!.position;
      const scale = Math.max(1, Math.abs(expected.x), Math.abs(expected.y), Math.abs(expected.z));
      expect(Math.abs(got.x - expected.x)).toBeLessThanOrEqual(scale * 1.2e-7);
      expect(Math.abs(got.y - expected.y)).toBeLessThanOrEqual(scale * 1.2e-7);
      expect(Math.abs(got.z - expected.z)).toBeLessThanOrEqual(scale * 1.2e-7);
    }
  });

  it('roundtrips quaternions at the quantisation boundaries', () => {
    const rotations: Quat[] = [
      { w: 1, x: 0, y: 0, z: 0 },
      { w: 0, x: 1, y: 0, z: 0 },
      { w: 0, x: 0, y: 1, z: 0 },
      { w: 0, x: 0, y: 0, z: 1 },
      { w: 0.5, x: 0.5, y: 0.5, z: 0.5 },
      { w: -0.7071067811865476, x: 0, y: 0.7071067811865476, z: 0 },
    ];
    const frames = rotations.map((rotation, i) => frame({ index: i, rotation }));
    const decoded = decodeTransformBatch(encodeTransformBatch(frames));
    for (let i = 0; i < rotations.length; i += 1) {
      const got = decoded.frames[i]!.rotation;
      const expected = normalizeQuat(rotations[i]);
      expect(Math.abs(got.w - expected.w)).toBeLessThanOrEqual(ROTATION_COMPONENT_TOLERANCE);
      expect(Math.abs(got.x - expected.x)).toBeLessThanOrEqual(ROTATION_COMPONENT_TOLERANCE);
      expect(Math.abs(got.y - expected.y)).toBeLessThanOrEqual(ROTATION_COMPONENT_TOLERANCE);
      expect(Math.abs(got.z - expected.z)).toBeLessThanOrEqual(ROTATION_COMPONENT_TOLERANCE);
      expect(quatAngleDegrees(got, expected)).toBeLessThanOrEqual(ROTATION_ANGLE_TOLERANCE_DEG);
      const len = Math.hypot(got.w, got.x, got.y, got.z);
      expect(Math.abs(len - 1)).toBeLessThan(1e-6);
    }
  });

  it('quantises a non-normalised quaternion to a unit quaternion', () => {
    const decoded = decodeTransformBatch(
      encodeTransformBatch([frame({ rotation: { w: 3, x: 0, y: 0, z: 4 } })]),
    );
    const got = decoded.frames[0]!.rotation;
    expect(got.w).toBeCloseTo(0.6, 4);
    expect(got.z).toBeCloseTo(0.8, 4);
  });

  it('sanitises NaN/Infinity into zero instead of poisoning the wire', () => {
    const decoded = decodeTransformBatch(
      encodeTransformBatch([
        frame({
          position: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 1 },
          velocity: { x: Number.NEGATIVE_INFINITY, y: Number.NaN, z: 0 },
          rotation: { w: Number.NaN, x: 0, y: 0, z: 0 },
        }),
      ]),
    );
    const got = decoded.frames[0]!;
    expect(got.position).toEqual({ x: 0, y: 0, z: 1 });
    expect(got.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(got.rotation).toEqual({ w: 1, x: 0, y: 0, z: 0 });
  });

  it('roundtrips the uint16 sequence wrap and the uint32 timestamp wrap', () => {
    const frames = [
      frame({ index: 1, seq: 65535, t: 0xffffffff }),
      frame({ index: 2, seq: 0, t: 0 }),
    ];
    const decoded = decodeTransformBatch(encodeTransformBatch(frames));
    expect(decoded.frames[0]!.seq).toBe(65535);
    expect(decoded.frames[0]!.t).toBe(0xffffffff);
    expect(decoded.frames[1]!.seq).toBe(0);
    expect(decoded.frames[1]!.t).toBe(0);
  });

  it('reports the exact number of bytes consumed', () => {
    const bytes = encodeTransformBatch([frame(), frame({ index: 5 }), frame({ index: 6 })]);
    expect(decodeTransformBatch(bytes).bytes).toBe(bytes.byteLength);
  });
});

describe('transformCodec — seq and time helpers', () => {
  it('treats a wrapped seq as newer', () => {
    expect(isNewerSeq(5, 4)).toBe(true);
    expect(isNewerSeq(4, 5)).toBe(false);
    expect(isNewerSeq(0, 65535)).toBe(true);
    expect(isNewerSeq(65535, 0)).toBe(false);
    expect(isNewerSeq(4, 4)).toBe(false);
    expect(isNewerSeq(32768, 0)).toBe(false); // half range is ambiguous, treated as stale
  });

  it('unwraps a timestamp that crossed the uint32 boundary', () => {
    const now = 0x1_0000_0000 + 500; // just after a wrap
    expect(unwrapTimestamp(100, now)).toBe(0x1_0000_0000 + 100);
    expect(unwrapTimestamp(0xfffffff0, now)).toBe(0xfffffff0);
    expect(unwrapTimestamp(toWireTimestamp(now), now)).toBe(now);
  });

  it('keeps toWireTimestamp inside uint32', () => {
    expect(toWireTimestamp(0x1_0000_0001)).toBe(1);
    expect(toWireTimestamp(-5)).toBe(0xfffffffb);
  });
});

describe('transformCodec — math helpers', () => {
  it('measures quaternion angle in degrees', () => {
    expect(quatAngleDegrees({ w: 1, x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 })).toBe(0);
    const ninety = { w: Math.SQRT1_2, x: 0, y: Math.SQRT1_2, z: 0 };
    expect(quatAngleDegrees({ w: 1, x: 0, y: 0, z: 0 }, ninety)).toBeCloseTo(90, 5);
    // q and -q are the same rotation
    expect(quatAngleDegrees(ninety, { w: -ninety.w, x: 0, y: -ninety.y, z: 0 })).toBeCloseTo(0, 5);
  });

  it('measures distance', () => {
    expect(distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it('clamps quantisation into int16', () => {
    const [w] = quantizeQuat({ w: 2, x: 0, y: 0, z: 0 });
    expect(w).toBe(ROTATION_QUANT_SCALE);
    const identity = dequantizeQuat(ROTATION_QUANT_SCALE, 0, 0, 0);
    expect(identity).toEqual({ w: 1, x: 0, y: 0, z: 0 });
  });
});

describe('TransformIdTable', () => {
  it('assigns stable, never-reused indices', () => {
    const table = new TransformIdTable();
    expect(table.indexOf('a')).toBe(0);
    expect(table.indexOf('b')).toBe(1);
    expect(table.indexOf('a')).toBe(0);
    expect(table.size).toBe(2);
    table.delete('a');
    expect(table.indexOf('c')).toBe(2);
    expect(table.idOf(1)).toBe('b');
    expect(table.idOf(0)).toBeUndefined();
  });

  it('adopts a server-assigned index', () => {
    const table = new TransformIdTable();
    table.assign('obj-9', 9);
    expect(table.indexOf('obj-9')).toBe(9);
    expect(table.indexOf('other')).toBe(10);
    expect(table.idOf(9)).toBe('obj-9');
  });

  it('rejects a conflicting assignment', () => {
    const table = new TransformIdTable();
    table.assign('a', 1);
    expect(() => table.assign('a', 2)).toThrow(/already has index 1/);
    expect(() => table.assign('b', 1)).toThrow(/already belongs to a/);
  });

  it('clears and reports entries', () => {
    const table = new TransformIdTable();
    table.indexOf('a');
    table.indexOf('b');
    expect(table.entries()).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    table.clear();
    expect(table.size).toBe(0);
    expect(table.indexOf('c')).toBe(0);
  });
});
