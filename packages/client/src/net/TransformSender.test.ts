import { describe, expect, it } from 'vitest';
import { decodeTransformBatch, type Transform } from '@chambler/shared';
import { TransformSender } from './TransformSender.js';

function transform(x = 0, y = 0, z = 0, deg = 0): Transform {
  const half = (deg * Math.PI) / 360;
  return {
    position: { x, y, z },
    rotation: { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

const FAST_VELOCITY = { x: 1, y: 0, z: 0 };

describe('TransformSender — motion gating', () => {
  it('sends the first frame of an object', () => {
    const sender = new TransformSender();
    expect(sender.enqueue('a', transform(1, 0, 0), FAST_VELOCITY, 1000)).toBe(true);
    expect(sender.queueSize).toBe(1);
  });

  it('suppresses a still object (sub-epsilon jitter)', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), undefined, 1000);
    sender.flush(1000);
    // 0.4 mm < 0.5 mm epsilon, no rotation
    const queued = sender.enqueue('a', transform(0.0004, 0, 0), undefined, 1050);
    expect(queued).toBe(false);
    expect(sender.queueSize).toBe(0);
    expect(sender.stats.framesSuppressed).toBe(1);
    expect(sender.flush(1100)).toHaveLength(0);
  });

  it('suppresses a sub-0.1-degree rotation', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0, 0), undefined, 1000);
    sender.flush(1000);
    expect(sender.enqueue('a', transform(0, 0, 0, 0.05), undefined, 1050)).toBe(false);
    expect(sender.stats.framesSuppressed).toBe(1);
  });

  it('sends a moving object again once it exceeds the epsilon', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), undefined, 1000);
    sender.flush(1000);
    expect(sender.enqueue('a', transform(0.01, 0, 0), FAST_VELOCITY, 1050)).toBe(true);
    const [packet] = sender.flush(1050);
    const decoded = decodeTransformBatch(packet!);
    expect(decoded.frames[0]!.position.x).toBeCloseTo(0.01, 4);
  });

  it('sends exactly one stop frame when the object comes to rest', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), FAST_VELOCITY, 1000);
    sender.flush(1000);
    // Move, then rest at the same pose
    sender.enqueue('a', transform(1, 0, 0), FAST_VELOCITY, 1050);
    sender.flush(1050);
    expect(sender.enqueue('a', transform(1, 0, 0), undefined, 1100)).toBe(true); // stop frame
    expect(sender.stats.stopFrames).toBe(1);
    const [packet] = sender.flush(1100);
    const frame = decodeTransformBatch(packet!).frames[0]!;
    expect(frame.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(frame.position.x).toBeCloseTo(1, 5);
    // nothing more while it stays still
    expect(sender.enqueue('a', transform(1, 0, 0), undefined, 1200)).toBe(false);
    expect(sender.flush(1200)).toHaveLength(0);
    expect(sender.stats.stopFrames).toBe(1);
  });
});

describe('TransformSender — adaptive rate', () => {
  it('uses 20 Hz for fast motion', () => {
    const sender = new TransformSender();
    let now = 0;
    sender.enqueue('a', transform(0, 0, 0), FAST_VELOCITY, now);
    sender.flush(now);
    let sent = 1;
    for (let tick = 1; tick <= 20; tick += 1) {
      now = tick * 10; // 100 Hz render loop
      if (sender.enqueue('a', transform(tick * 0.1, 0, 0), FAST_VELOCITY, now)) {
        sender.flush(now);
        sent += 1;
      }
    }
    // 200 ms of motion at 20 Hz => ~5 frames (first + 4 intervals)
    expect(sent).toBeGreaterThanOrEqual(4);
    expect(sent).toBeLessThanOrEqual(6);
    expect(sender.stats.framesDropped).toBeGreaterThan(0); // the 100 Hz samples in between
  });

  it('uses 5 Hz for slow motion', () => {
    const sender = new TransformSender();
    let now = 0;
    sender.enqueue('a', transform(0, 0, 0), { x: 0.01, y: 0, z: 0 }, now);
    sender.flush(now);
    let sent = 1;
    for (let tick = 1; tick <= 100; tick += 1) {
      now = tick * 10; // 100 Hz for 1 s
      // slow drift: 0.6 mm per 10 ms = 0.06 m/s -> "slow" bucket (5 Hz)
      if (sender.enqueue('a', transform(tick * 0.0006, 0, 0), { x: 0.06, y: 0, z: 0 }, now)) {
        sender.flush(now);
        sent += 1;
      }
    }
    expect(sent).toBeGreaterThanOrEqual(4);
    expect(sent).toBeLessThanOrEqual(7); // ~5 Hz over 1 s
  });

  it('drops the older sample when a newer one arrives inside the interval', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), FAST_VELOCITY, 0);
    sender.flush(0);
    sender.enqueue('a', transform(0.1, 0, 0), FAST_VELOCITY, 10);
    sender.enqueue('a', transform(0.2, 0, 0), FAST_VELOCITY, 20);
    sender.enqueue('a', transform(0.3, 0, 0), FAST_VELOCITY, 30);
    expect(sender.stats.framesDropped).toBe(2);
    const [packet] = sender.flush(60);
    // only the newest sample is sent
    expect(decodeTransformBatch(packet!).frames[0]!.position.x).toBeCloseTo(0.3, 5);
  });
});

describe('TransformSender — per-frame budget and queue', () => {
  it('caps a flush at maxObjectsPerFrame and keeps the rest queued', () => {
    const sender = new TransformSender({ maxObjectsPerFrame: 4, maxQueue: 32 });
    for (let i = 0; i < 10; i += 1) {
      sender.enqueue(`o${i}`, transform(i, 0, 0), FAST_VELOCITY, 1000);
    }
    expect(sender.queueSize).toBe(10);
    const first = sender.flush(1000);
    expect(first).toHaveLength(1);
    expect(first[0]![1]).toBe(4);
    expect(sender.queueSize).toBe(6);
    expect(sender.stats.framesDeferred).toBe(6);

    const second = sender.flush(1000);
    expect(second[0]![1]).toBe(4);
    expect(sender.queueSize).toBe(2);
    const third = sender.flush(1000);
    expect(third[0]![1]).toBe(2);
    expect(sender.queueSize).toBe(0);
    expect(sender.stats.framesSent).toBe(10);
  });

  it('sends the oldest queued frames first', () => {
    const sender = new TransformSender({ maxObjectsPerFrame: 2, maxQueue: 8 });
    sender.enqueue('first', transform(1, 0, 0), FAST_VELOCITY, 1000);
    sender.enqueue('second', transform(2, 0, 0), FAST_VELOCITY, 1000);
    sender.enqueue('third', transform(3, 0, 0), FAST_VELOCITY, 1000);
    const [packet] = sender.flush(1000);
    const ids = decodeTransformBatch(packet!).frames.map((f) => sender.idTable.idOf(f.index));
    expect(ids).toEqual(['first', 'second']);
  });

  it('drops the oldest queued frame when the queue overflows', () => {
    const sender = new TransformSender({ maxObjectsPerFrame: 2, maxQueue: 3 });
    for (let i = 0; i < 5; i += 1) {
      sender.enqueue(`o${i}`, transform(i + 1, 0, 0), FAST_VELOCITY, 1000);
    }
    expect(sender.queueSize).toBe(3);
    expect(sender.stats.framesDropped).toBe(2);
    const ids = sender.queued().map((q) => q.id);
    expect(ids).toEqual(['o2', 'o3', 'o4']); // o0/o1 (oldest) dropped
  });

  it('keeps the sequence number monotonic per object', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), FAST_VELOCITY, 0);
    const first = decodeTransformBatch(sender.flush(0)[0]!).frames[0]!;
    sender.enqueue('a', transform(1, 0, 0), FAST_VELOCITY, 100);
    const second = decodeTransformBatch(sender.flush(100)[0]!).frames[0]!;
    expect(second.seq).toBe(first.seq + 1);
  });

  it('forgets an object on release', () => {
    const sender = new TransformSender();
    sender.enqueue('a', transform(0, 0, 0), FAST_VELOCITY, 0);
    sender.forget('a');
    expect(sender.queueSize).toBe(0);
    // a re-added object starts from scratch: first sample is always sent
    expect(sender.enqueue('a', transform(0, 0, 0), undefined, 10)).toBe(true);
  });

  it('flushTo hands every packet to the transport', () => {
    const sender = new TransformSender({ maxObjectsPerFrame: 2 });
    for (let i = 0; i < 3; i += 1) sender.enqueue(`o${i}`, transform(i, 0, 0), FAST_VELOCITY, 0);
    const packets: Uint8Array[] = [];
    const sent = sender.flushTo(0, (bytes) => packets.push(bytes));
    expect(packets).toHaveLength(1);
    expect(sent).toBe(2);
    expect(sender.queueSize).toBe(1);
  });

  it('reuses the server-assigned index table', () => {
    const sender = new TransformSender();
    sender.registerIndex('die-1', 7);
    sender.enqueue('die-1', transform(0, 0, 0), FAST_VELOCITY, 0);
    const frame = decodeTransformBatch(sender.flush(0)[0]!).frames[0]!;
    expect(frame.index).toBe(7);
    expect(sender.idTable.idOf(7)).toBe('die-1');
  });
});
