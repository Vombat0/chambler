/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as ServerRoom } from 'colyseus';
import type { Room as ClientRoom } from 'colyseus.js';
import { decodeTransformBatch, encodeTransformBatch, type WireTransformFrame } from '@chambler/shared';
import { createChamblerServer, type ChamblerServer } from '../app.js';
import { TABLE_ROOM_NAME, type TableRoom } from './TableRoom.js';
import type { TableState } from './TableState.js';

type ServerTable = ServerRoom<TableState>;
type TestClient = ClientRoom<TableState>;

let chambler: ChamblerServer;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  chambler = createChamblerServer({
    port: 0,
    maxPlayers: 8,
    reconnectionSeconds: 2,
    chatMaxLength: 300,
    chatRateLimit: 10,
    chatRateWindowMs: 1000,
    // 32 KB/s room budget => 4 KB/s per seat: a 20-object batch (1.6 KB) fits,
    // a 60-object burst (4.8 KB) is visibly trimmed.
    transformBudgetBytesPerSec: 32768,
    transformFlushMs: 20,
  });
  colyseus = await boot(chambler.gameServer);
});
afterAll(async () => {
  await colyseus.cleanup();
  await chambler.stop();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

function waitUntil(pred: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (pred()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout ${label}`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function nextMessage<T>(room: TestClient, type: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout ${type}`));
    }, timeoutMs);
    const off = room.onMessage<T>(type, (m) => {
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTable(): Promise<ServerTable> {
  return colyseus.createRoom<TableState>(TABLE_ROOM_NAME);
}
async function join(room: ServerTable, name: string): Promise<TestClient> {
  return colyseus.connectTo(room, { name });
}

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

function objectPayload(id: string, ownerId: string | null, kind = 'pawn', meta: Record<string, unknown> = {}) {
  return {
    object: {
      id,
      kind,
      assetRef: '',
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT },
      ownerId,
      locked: false,
      faceUp: true,
      meta,
    },
  };
}

async function spawnOwned(room: ServerTable, client: TestClient, id: string, kind = 'pawn', meta: Record<string, unknown> = {}) {
  client.send('objectSpawn', objectPayload(id, client.sessionId, kind, meta));
  await waitUntil(() => room.state.objects.has(id), `spawn ${id}`);
  client.send('objectClaim', { objectId: id });
  await waitUntil(() => room.state.objects.get(id)?.ownerId === client.sessionId, `claim ${id}`);
  const os = room.state.objects.get(id)!;
  return os.netIndex;
}

function wireFrame(index: number, seq: number, x: number): WireTransformFrame {
  return {
    index,
    position: { x, y: 0.5, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
    seq,
    t: Date.now(),
  };
}

describe('B3 binary transform batch', () => {
  it('relays a binary batch and the receiver decodes the pose', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const index = await spawnOwned(room, alice, 'b1');

    const received = nextMessage<Uint8Array>(bob, 'transformBatch');
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 1, 7)]));
    const packet = await received;
    expect(packet).toBeInstanceOf(Uint8Array);
    const decoded = decodeTransformBatch(packet);
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0]!.index).toBe(index);
    expect(decoded.frames[0]!.position.x).toBeCloseTo(7, 4);
    expect(decoded.frames[0]!.position.y).toBeCloseTo(0.5, 4);
  });

  it('batches several objects into one packet (20 objects, one broadcast)', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const indices: number[] = [];
    for (let i = 0; i < 20; i += 1) indices.push(await spawnOwned(room, alice, `many-${i}`));

    const frames = indices.map((index, i) => wireFrame(index, 1, i));
    const received = nextMessage<Uint8Array>(bob, 'transformBatch');
    alice.send('transformBatch', encodeTransformBatch(frames));
    const decoded = decodeTransformBatch(await received);
    expect(decoded.frames).toHaveLength(20);
    expect(decoded.bytes).toBe(2 + 20 * 40);
  });

  it('rejects a malformed batch without dropping the session', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('transformBatch', new Uint8Array([0x01, 9, 0, 0]));
    expect((await err).code).toBe('TRANSFORM_MALFORMED');

    // still connected and able to chat
    const chat = nextMessage<{ type: string; text: string }>(alice, 'chat');
    alice.send('chat', { text: 'still here' });
    expect((await chat).text).toBe('still here');
  });

  it('rejects a non-binary payload', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('transformBatch', { not: 'bytes' });
    expect((await err).code).toBe('TRANSFORM_MALFORMED');
  });

  it('rejects an index owned by another player', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const index = await spawnOwned(room, alice, 'owned-by-alice');

    const err = nextMessage<{ code: string }>(bob, 'error');
    bob.send('transformBatch', encodeTransformBatch([wireFrame(index, 1, 3)]));
    expect((await err).code).toBe('TRANSFORM_FORBIDDEN');
  });

  it('ignores an unknown object index silently', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'b5');
    const packets: Uint8Array[] = [];
    bob.onMessage('transformBatch', (m) => packets.push(m as Uint8Array));
    alice.send('transformBatch', encodeTransformBatch([wireFrame(60000, 1, 3)]));
    await delay(120);
    expect(packets).toHaveLength(0);
  });

  it('drops a stale seq (no broadcast)', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const index = await spawnOwned(room, alice, 'b6');

    const first = nextMessage<Uint8Array>(bob, 'transformBatch');
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 10, 1)]));
    await first;

    const packets: Uint8Array[] = [];
    bob.onMessage('transformBatch', (m) => packets.push(m as Uint8Array));
    await delay(60); // clear the per-object 50 ms floor
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 9, 2)]));
    await delay(150);
    expect(packets).toHaveLength(0);
  });

  it('applies the per-object frequency floor', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const index = await spawnOwned(room, alice, 'b7');

    const packets: Uint8Array[] = [];
    bob.onMessage('transformBatch', (m) => packets.push(m as Uint8Array));
    // three packets in the same millisecond: only the first can pass
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 1, 1)]));
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 2, 2)]));
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 3, 3)]));
    await delay(200);
    expect(packets.length).toBeGreaterThanOrEqual(1);
    expect(packets.length).toBeLessThanOrEqual(2);
  });

  it('trims a greedy client fairly and keeps the session alive', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const carol = await join(room, 'Carol');
    void bob;
    void carol;
    const indices: number[] = [];
    for (let i = 0; i < 60; i += 1) indices.push(await spawnOwned(room, alice, `burst-${i}`));

    const frames = indices.map((index, i) => wireFrame(index, 1, i));
    // 60 frames x 40 B x 2 non-owner recipients = 4800 B in one tick, vs a
    // 4096 B/s per-player share -> the tail of the burst is trimmed.
    // FIX-PLAYABILITY-1: trimming is SILENT — no 'error' frame reaches the
    // client (it scared users as a red toast); only the metric moves.
    alice.send('transformBatch', encodeTransformBatch(frames));
    await delay(150);

    const instance = colyseus.getRoomById<TableRoom>(room.roomId);
    expect(instance.getMetrics().budgetRejections).toBeGreaterThanOrEqual(1);

    // still connected
    const chat = nextMessage<{ text: string }>(bob, 'chat');
    alice.send('chat', { text: 'trimmed but alive' });
    expect((await chat).text).toBe('trimmed but alive');
    expect(room.state.players.has(alice.sessionId)).toBe(true);
  });

  it('exposes counters through getMetrics()', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const index = await spawnOwned(room, alice, 'm1');
    const received = nextMessage<Uint8Array>(bob, 'transformBatch');
    alice.send('transformBatch', encodeTransformBatch([wireFrame(index, 1, 4)]));
    await received;
    await delay(60);

    const instance = colyseus.getRoomById<TableRoom>(room.roomId);
    const metrics = instance.getMetrics();
    expect(metrics.transformFramesAccepted).toBeGreaterThanOrEqual(1);
    expect(metrics.transformBatchesSent).toBeGreaterThanOrEqual(1);
    // the owner is excluded, so one frame costs one 40 B record + packet header
    expect(metrics.transformBytesSent).toBeGreaterThanOrEqual(40);
    expect(metrics.players).toBe(2);
    expect(metrics.objects).toBe(1);
    expect(metrics.budget.perPlayer).toBeDefined();
  });
});

describe('B3 die results', () => {
  it('accepts a valid result, persists it and broadcasts it', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'die1', 'die', { faces: 6 });

    const received = nextMessage<any>(bob, 'dieResult');
    alice.send('dieResult', { objectId: 'die1', value: 4 });
    const msg = await received;
    expect(msg).toMatchObject({ type: 'dieResult', objectId: 'die1', value: 4, faces: 6 });
    expect(msg.playerId).toBe(alice.sessionId);
    await waitUntil(() => room.state.objects.get('die1')!.dieValue === 4, 'persisted');
    expect(room.state.objects.get('die1')!.dieRolledBy).toBe(alice.sessionId);
  });

  it('rejects an out-of-range value', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawnOwned(room, alice, 'die2', 'die', { faces: 6 });
    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('dieResult', { objectId: 'die2', value: 9 });
    expect((await err).code).toBe('DIE_RESULT_INVALID');
  });

  it('validates against the die face count from meta', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawnOwned(room, alice, 'd20', 'die', { faces: 20 });
    const received = nextMessage<any>(alice, 'dieResult');
    alice.send('dieResult', { objectId: 'd20', value: 20 });
    expect((await received).faces).toBe(20);
  });

  it('rejects a result for a non-die object', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawnOwned(room, alice, 'card1', 'card');
    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('dieResult', { objectId: 'card1', value: 2 });
    expect((await err).code).toBe('DIE_NOT_DIE');
  });

  it('rejects a report from a non-owner', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'die3', 'die');
    const err = nextMessage<{ code: string }>(bob, 'error');
    bob.send('dieResult', { objectId: 'die3', value: 3 });
    expect((await err).code).toBe('DIE_FORBIDDEN');
  });

  it('rejects a contradictory result inside the same throw, then accepts it after a re-claim', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawnOwned(room, alice, 'die4', 'die');

    const first = nextMessage<any>(alice, 'dieResult');
    alice.send('dieResult', { objectId: 'die4', value: 1 });
    expect((await first).value).toBe(1);

    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('dieResult', { objectId: 'die4', value: 6 });
    expect((await err).code).toBe('DIE_RESULT_CONFLICT');
    expect(room.state.objects.get('die4')!.dieValue).toBe(1);

    // picking the die up mints a new claim token -> new result epoch
    alice.send('objectClaim', { objectId: 'die4' });
    await delay(80);
    const second = nextMessage<any>(alice, 'dieResult');
    alice.send('dieResult', { objectId: 'die4', value: 6 });
    expect((await second).value).toBe(6);
    await waitUntil(() => room.state.objects.get('die4')!.dieValue === 6, 'updated');
  });

  it('reports OBJECT_NOT_FOUND for an unknown die', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const err = nextMessage<{ code: string }>(alice, 'error');
    alice.send('dieResult', { objectId: 'nope', value: 2 });
    expect((await err).code).toBe('OBJECT_NOT_FOUND');
  });

  it('a late joiner sees the persisted die value in room state', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawnOwned(room, alice, 'die5', 'die');
    const received = nextMessage<any>(alice, 'dieResult');
    alice.send('dieResult', { objectId: 'die5', value: 5 });
    await received;

    const bob = await join(room, 'Bob');
    await waitUntil(() => bob.state?.objects?.get('die5')?.dieValue === 5, 'state sync', 5000);
    expect(bob.state!.objects.get('die5')!.dieValue).toBe(5);
  });

  it('a reconnecting client still has the last die result', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'die6', 'die');
    const received = nextMessage<any>(bob, 'dieResult');
    alice.send('dieResult', { objectId: 'die6', value: 3 });
    await received;

    const token = bob.reconnectionToken;
    const oldId = bob.sessionId;
    await bob.leave(false);
    await waitUntil(
      () => !room.state.players.has(oldId) || room.state.players.get(oldId)?.connected === false,
      'bob disconnected',
    );
    const bob2 = await colyseus.sdk.reconnect(token);
    await waitUntil(() => room.state.players.has(bob2.sessionId), 'bob reconnected');
    await waitUntil(
      () => bob2.state?.objects?.get('die6')?.dieValue === 3,
      'die value restored',
    );
    expect(bob2.state!.objects.get('die6')!.dieValue).toBe(3);
    // the server-side state (authority) also kept it
    expect(room.state.objects.get('die6')!.dieValue).toBe(3);
  });
});

describe('B3 backwards compatibility', () => {
  it('still relays the legacy JSON transform frame', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'legacy1');
    const received = nextMessage<any>(bob, 'transformUpdate');
    alice.send('transformUpdate', {
      id: 'legacy1',
      transform: { position: { x: 2, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT },
      seq: 1,
      t: Date.now(),
    });
    const msg = await received;
    expect(msg.id).toBe('legacy1');
    expect(msg.transform.position.x).toBe(2);
  });

  it('counts legacy frames separately in metrics', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawnOwned(room, alice, 'legacy2');
    const received = nextMessage<any>(bob, 'transformUpdate');
    alice.send('transformUpdate', {
      id: 'legacy2',
      transform: { position: { x: 1, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT },
      seq: 1,
      t: Date.now(),
    });
    await received;
    const metrics = colyseus.getRoomById<TableRoom>(room.roomId).getMetrics();
    expect(metrics.legacyJsonFrames).toBe(1);
  });
});
