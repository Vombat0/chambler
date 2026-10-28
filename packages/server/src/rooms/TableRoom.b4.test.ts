/**
 * B4 integration tests: persistence (debounced saves, interval cap, dispose
 * saves, snapshot content, restore) and reconnection (pending ownership,
 * tableResync with secret filtering).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { matchMaker, type Room as ServerRoom } from 'colyseus';
import type { Room as ClientRoom } from 'colyseus.js';
import { SNAPSHOT_SCHEMA_VERSION, type TableSnapshot } from '@chambler/shared';
import { createChamblerServer, type ChamblerServer } from '../app.js';
import { TABLE_ROOM_NAME, type TableRoom } from './TableRoom.js';
import type { TableState } from './TableState.js';

type ServerTable = ServerRoom<TableState>;
type TestClient = ClientRoom<TableState>;

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

let savesDir: string;
let chambler: ChamblerServer;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambler-b4-rooms-'));
  chambler = createChamblerServer({
    port: 0,
    maxPlayers: 8,
    reconnectionSeconds: 1,
    snapshotDir: savesDir,
    // debounce 250 ms (quiet period), interval cap 2000 ms (hard cadence):
    // both are observable in distinct tests below.
    snapshotDebounceMs: 250,
    snapshotMaxIntervalMs: 2000,
  });
  colyseus = await boot(chambler.gameServer);
});
afterAll(async () => {
  await colyseus.cleanup();
  await chambler.stop();
  fs.rmSync(savesDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await colyseus.cleanup();
  for (const entry of fs.readdirSync(savesDir)) {
    fs.rmSync(path.join(savesDir, entry), { recursive: true, force: true });
  }
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

async function createTable(): Promise<ServerTable> {
  return colyseus.createRoom<TableState>(TABLE_ROOM_NAME);
}
async function join(room: ServerTable, name: string): Promise<TestClient> {
  return colyseus.connectTo(room, { name });
}

function spawnPayload(id: string, kind = 'pawn', transform: unknown = null, meta: Record<string, unknown> = {}) {
  return {
    object: {
      id,
      kind,
      assetRef: kind === 'die' ? 'risk/die-black' : `risk/${kind}`,
      transform: transform ?? { position: { x: 1, y: 0.5, z: -2 }, rotation: IDENTITY, scale: UNIT },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta,
    },
  };
}

async function spawn(room: ServerTable, client: TestClient, id: string, kind = 'pawn', transform: unknown = null, meta: Record<string, unknown> = {}) {
  client.send('objectSpawn', spawnPayload(id, kind, transform, meta));
  await waitUntil(() => room.state.objects.has(id), `spawn ${id}`);
}

function saveFile(code: string): string {
  return path.join(savesDir, `${code}.json`);
}

function liveRoom(code: string): TableRoom | undefined {
  return matchMaker.getLocalRoomById(code) as TableRoom | undefined;
}

describe('B4 autosave', () => {
  it('debounces: nothing is written before the debounce elapses, then it is', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawn(room, alice, 'pawn-1');
    expect(fs.existsSync(saveFile(room.roomId))).toBe(false);
    await waitUntil(() => fs.existsSync(saveFile(room.roomId)), 'debounced save appears', 1500);
    const raw = JSON.parse(fs.readFileSync(saveFile(room.roomId), 'utf8')) as TableSnapshot;
    expect(raw.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(raw.roomCode).toBe(room.roomId);
    expect(raw.objects.map((o) => o.id)).toEqual(['pawn-1']);
    expect(raw.objects[0]!.transform.position.x).toBe(1);
  });

  it('forces a save on the interval cap while changes keep coming', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    // Changes every 20 ms: the 250 ms debounce never settles, so only the
    // 2000 ms interval cap can produce a save. Keep changes going past it.
    const stop = setInterval(() => {
      alice.send('objectSpawn', spawnPayload(`obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`));
    }, 20);
    try {
      await waitUntil(() => fs.existsSync(saveFile(room.roomId)), 'interval-capped save', 4000);
    } finally {
      clearInterval(stop);
    }
  });

  it('saves on dispose even without any debounce fire', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawn(room, alice, 'die-1', 'die', null, { faces: 6 });
    expect(fs.existsSync(saveFile(room.roomId))).toBe(false);
    await room.disconnect();
    await waitUntil(() => fs.existsSync(saveFile(room.roomId)), 'dispose save', 1500);
  });

  it('never writes a save for an empty room nobody joined', async () => {
    const room = await createTable();
    await room.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fs.existsSync(saveFile(room.roomId))).toBe(false);
  });
});

describe('B4 snapshot content', () => {
  it('stores die results and last transforms, and never a card face', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawn(room, alice, 'die-1', 'die', null, { faces: 6 });
    alice.send('objectClaim', { objectId: 'die-1' });
    await waitUntil(() => room.state.objects.get('die-1')?.ownerId === alice.sessionId, 'claim');
    alice.send('dieResult', { objectId: 'die-1', value: 4 });
    await waitUntil(() => room.state.objects.get('die-1')?.dieValue === 4, 'die result');
    // A face-down card with a secret identity and a deck with a face mapping.
    await spawn(room, alice, 'card-1', 'card', null, { cardId: 'infantry-7' });
    room.state.objects.get('card-1')!.faceUp = false;
    await spawn(room, alice, 'deck-1', 'deck', null, {
      cardIds: ['infantry-7', 'cavalry-2'],
      faceMap: { 'infantry-7': 'risk/card-infantry' },
    });
    // Move the die through the legacy transform channel: lastTransforms must follow.
    alice.send('transformUpdate', {
      id: 'die-1',
      transform: { position: { x: 3, y: 0.5, z: 7 }, rotation: IDENTITY, scale: UNIT },
      seq: 1,
      t: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const table = liveRoom(room.roomId)!;
    const result = table.persistNow(); // deterministic write for the assertions
    expect(result.ok).toBe(true);
    const snapshot = table.buildSnapshot();
    const file = JSON.parse(fs.readFileSync(saveFile(room.roomId), 'utf8')) as TableSnapshot;

    expect(snapshot.dieValues['die-1']).toMatchObject({ value: 4 });
    const die = snapshot.objects.find((o) => o.id === 'die-1')!;
    expect(die.transform.position.x).toBe(3);
    expect(die.transform.position.z).toBe(7);
    const card = snapshot.objects.find((o) => o.id === 'card-1')!;
    expect(card.meta).not.toHaveProperty('cardId');
    expect(card.assetRef.endsWith('#back')).toBe(true);
    const deck = snapshot.objects.find((o) => o.id === 'deck-1')!;
    expect(deck.meta.cardIds).toEqual(['infantry-7', 'cavalry-2']);
    expect(deck.meta).not.toHaveProperty('faceMap');

    // The file on disk carries the same guarantees.
    const fileCard = file.objects.find((o) => o.id === 'card-1')!;
    expect(fileCard.meta).not.toHaveProperty('cardId');
    expect(fileCard.assetRef.endsWith('#back')).toBe(true);
    expect(file.objects.find((o) => o.id === 'deck-1')!.meta).not.toHaveProperty('faceMap');
    expect(file.dieValues['die-1']!.value).toBe(4);
    expect(file.objects.find((o) => o.id === 'die-1')!.transform.position.x).toBe(3);
    await room.disconnect();
  });
});

describe('B4 restore', () => {
  it('reopens a disposed room from its snapshot with objects and die results', async () => {
    const room = await createTable();
    const code = room.roomId;
    const alice = await join(room, 'Alice');
    await spawn(room, alice, 'die-1', 'die', null, { faces: 6 });
    alice.send('objectClaim', { objectId: 'die-1' });
    await waitUntil(() => room.state.objects.get('die-1')?.ownerId === alice.sessionId, 'claim');
    alice.send('dieResult', { objectId: 'die-1', value: 6 });
    await waitUntil(() => room.state.objects.get('die-1')?.dieValue === 6, 'die');
    await spawn(room, alice, 'pawn-1', 'pawn', { position: { x: 2, y: 1, z: 2 }, rotation: IDENTITY, scale: UNIT });
    await room.disconnect();
    await waitUntil(() => fs.existsSync(saveFile(code)), 'save on dispose', 1500);

    // Reopen by code: a new room instance restored from the snapshot.
    const reopened = await colyseus.createRoom<TableState>(TABLE_ROOM_NAME, { restoreCode: code });
    expect(reopened.roomId).toBe(code);
    expect(reopened.state.code).toBe(code);
    expect(reopened.state.objects.has('die-1')).toBe(true);
    expect(reopened.state.objects.has('pawn-1')).toBe(true);
    expect(reopened.state.objects.get('die-1')!.dieValue).toBe(6);
    expect(reopened.state.objects.get('die-1')!.ownerId).toBe(''); // free after restart

    // A joining client gets the full table via tableResync (with transforms)
    // and the die result replay. Both handlers are registered up-front: the
    // replayed dieResult arrives before the tableResync.
    const bob = await join(reopened, 'Bob');
    const resyncP = nextMessage<{
      type: string;
      roomCode: string;
      objects: Array<{ id: string; transform: { position: { x: number } } }>;
    }>(bob, 'tableResync');
    const dieP = nextMessage<{ objectId: string; value: number }>(bob, 'dieResult');
    const resync = await resyncP;
    expect(resync.roomCode).toBe(code);
    expect(resync.objects.find((o) => o.id === 'die-1')).toBeDefined();
    expect(resync.objects.find((o) => o.id === 'pawn-1')!.transform.position.x).toBe(2);
    const dieMsg = await dieP;
    expect(dieMsg.objectId).toBe('die-1');
    expect(dieMsg.value).toBe(6);
    // ...and the schema state agrees.
    expect(bob.state?.objects?.get('die-1')?.dieValue).toBe(6);
  });

  it('gives a returning player their remembered seat and colour', async () => {
    const room = await createTable();
    const code = room.roomId;
    const alice = await join(room, 'Alice');
    const firstSeat = room.state.players.get(alice.sessionId)!.seat;
    const firstColor = room.state.players.get(alice.sessionId)!.color;
    alice.send('seat', { seat: 4 });
    alice.send('color', { color: '#457b9d' });
    await waitUntil(() => room.state.players.get(alice.sessionId)?.seat === 4, 'seat change');
    await room.disconnect();

    const reopened = await colyseus.createRoom<TableState>(TABLE_ROOM_NAME, { restoreCode: code });
    const alice2 = await join(reopened, 'Alice');
    const player = reopened.state.players.get(alice2.sessionId)!;
    expect(player.seat).toBe(4);
    expect(player.color).toBe('#457b9d');
    expect(firstSeat).toBe(0);
    expect(firstColor).toBe('#e63946');
  });

  it('falls back to a fresh code when no snapshot exists for the restore code', async () => {
    const room = await colyseus.createRoom<TableState>(TABLE_ROOM_NAME, { restoreCode: 'ZZZZZ' });
    expect(room.roomId).not.toBe('ZZZZZ');
    expect(room.state.objects.size).toBe(0);
  });
});

describe('B4 reconnection', () => {
  it('keeps ownership pending and restores it on reconnect within the window', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawn(room, alice, 'pawn-1');
    alice.send('objectClaim', { objectId: 'pawn-1' });
    await waitUntil(() => room.state.objects.get('pawn-1')?.ownerId === alice.sessionId, 'claim');

    const token = alice.reconnectionToken;
    await alice.leave(false);
    await waitUntil(() => room.state.players.get(alice.sessionId)?.connected === false, 'disconnected');
    // Ownership is "pending": still assigned while the window is open.
    expect(room.state.objects.get('pawn-1')?.ownerId).toBe(alice.sessionId);

    const release = nextMessage<{ objectId: string }>(bob, 'objectRelease', 2000);
    const alice2 = await colyseus.sdk.reconnect(token);
    await waitUntil(() => room.state.players.has(alice2.sessionId), 'reconnected');
    await waitUntil(() => room.state.objects.get('pawn-1')?.ownerId === alice2.sessionId, 'ownership restored');
    // No release broadcast: the player came back inside the window.
    await expect(release).rejects.toThrow(/timeout/);
  });

  it('releases and broadcasts pending ownership when the window expires', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawn(room, alice, 'pawn-2');
    alice.send('objectClaim', { objectId: 'pawn-2' });
    await waitUntil(() => room.state.objects.get('pawn-2')?.ownerId === alice.sessionId, 'claim');

    const release = nextMessage<{ objectId: string; playerId: string }>(bob, 'objectRelease', 4000);
    await alice.leave(false);
    const msg = await release;
    expect(msg.objectId).toBe('pawn-2');
    expect(msg.playerId).toBe(alice.sessionId);
    // Window (1 s) expired: the object is free and the player entry is gone.
    await waitUntil(() => room.state.objects.get('pawn-2')?.ownerId === '', 'released');
    await waitUntil(() => !room.state.players.has(alice.sessionId), 'player removed');
  });

  it('releases ownership immediately on a consented leave', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    await spawn(room, alice, 'pawn-3');
    alice.send('objectClaim', { objectId: 'pawn-3' });
    await waitUntil(() => room.state.objects.get('pawn-3')?.ownerId === alice.sessionId, 'claim');
    const release = nextMessage<{ objectId: string }>(bob, 'objectRelease', 3000);
    await alice.leave(true);
    expect((await release).objectId).toBe('pawn-3');
    await waitUntil(() => room.state.objects.get('pawn-3')?.ownerId === '', 'released');
  });

  it('sends a secret-filtered tableResync to joining clients', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    await spawn(room, alice, 'card-1', 'card', null, { cardId: 'cavalry-3' });
    room.state.objects.get('card-1')!.faceUp = false;
    const bob = await join(room, 'Bob');
    const resync = await nextMessage<{
      objects: Array<{ id: string; meta: Record<string, unknown>; assetRef: string }>;
    }>(bob, 'tableResync');
    const card = resync.objects.find((o) => o.id === 'card-1')!;
    expect(card).toBeDefined();
    expect(card.meta).not.toHaveProperty('cardId');
    expect(card.assetRef.endsWith('#back')).toBe(true);
  });
});
