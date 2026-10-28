/**
 * B4 HTTP API integration tests: /api/rooms/:code/save, /api/saves and
 * /api/rooms/:code/reopen against a real bound server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'colyseus.js';
import { SNAPSHOT_SCHEMA_VERSION, type TableSnapshot } from '@chambler/shared';
import { createChamblerServer, type ChamblerServer } from './app.js';

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

let savesDir: string;
let chambler: ChamblerServer;
let port = 0;
let sdk: Client;

beforeAll(async () => {
  savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambler-b4-api-'));
  chambler = createChamblerServer({
    port: 0,
    reconnectionSeconds: 1,
    snapshotDir: savesDir,
    snapshotDebounceMs: 10_000, // keep autosave out of the way; tests save explicitly
    snapshotMaxIntervalMs: 30_000,
  });
  port = await chambler.start();
  sdk = new Client(`ws://127.0.0.1:${port}`);
});
afterAll(async () => {
  await chambler.stop();
  fs.rmSync(savesDir, { recursive: true, force: true });
});
beforeEach(() => {
  for (const entry of fs.readdirSync(savesDir)) {
    fs.rmSync(path.join(savesDir, entry), { recursive: true, force: true });
  }
});

function url(pathname: string): string {
  return `http://127.0.0.1:${port}${pathname}`;
}

async function createRoomWithObject(name = 'Alice'): Promise<{ code: string; sessionId: string }> {
  const room = await sdk.create('table', { name });
  room.send('objectSpawn', {
    object: {
      id: 'pawn-http',
      kind: 'pawn',
      assetRef: 'risk/pawn-red',
      transform: { position: { x: 5, y: 0, z: 5 }, rotation: IDENTITY, scale: UNIT },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta: {},
    },
  });
  for (let i = 0; i < 100 && !room.state?.objects?.has('pawn-http'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!room.state?.objects?.has('pawn-http')) {
    throw new Error('object did not spawn');
  }
  const { code, sessionId } = { code: room.roomId, sessionId: room.sessionId };
  await room.leave(true);
  return { code, sessionId };
}

async function waitRoomGone(code: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const res = await fetch(url(`/api/rooms/${code}`));
    if (res.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`room ${code} did not dispose`);
}

describe('POST /api/rooms/:code/save', () => {
  it('rejects an invalid code', async () => {
    const res = await fetch(url('/api/rooms/nope/save?sessionId=x'), { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ROOM_CODE_INVALID');
  });

  it('404s for a room that is not live', async () => {
    const res = await fetch(url('/api/rooms/ZZZZZ/save?sessionId=x'), { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not the host', async () => {
    const room = await sdk.create('table', { name: 'Alice' });
    const bob = await sdk.joinById(room.roomId, { name: 'Bob' });
    const res = await fetch(url(`/api/rooms/${room.roomId}/save?sessionId=${bob.sessionId}`), { method: 'POST' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NOT_HOST');
    await bob.leave(true);
    await room.leave(true);
  });

  it('saves for the host and reports the save', async () => {
    const { code } = await createRoomWithObject();
    // The room disposed after createRoomWithObject left; bring it back first.
    const reopen = await fetch(url(`/api/rooms/${code}/reopen`), { method: 'POST' });
    expect(reopen.status).toBe(200);
    const joined = await sdk.joinById(code, { name: 'Alice' });
    const res = await fetch(url(`/api/rooms/${code}/save?sessionId=${joined.sessionId}`), { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; bytes: number; objects: number };
    expect(body.code).toBe(code);
    expect(body.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(savesDir, `${code}.json`))).toBe(true);
    await joined.leave(true);
    await waitRoomGone(code);
  });
});

describe('GET /api/rooms/:code/save', () => {
  it('returns the live room snapshot', async () => {
    const room = await sdk.create('table', { name: 'Alice' });
    const res = await fetch(url(`/api/rooms/${room.roomId}/save`));
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as TableSnapshot;
    expect(snapshot.roomCode).toBe(room.roomId);
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    await room.leave(true);
    await waitRoomGone(room.roomId);
  });

  it('returns the disk snapshot when the room is not live', async () => {
    const { code } = await createRoomWithObject();
    // createRoomWithObject disposed the room but never saved: save it via disk
    // by reopening + host save, then letting it dispose again.
    await fetch(url(`/api/rooms/${code}/reopen`), { method: 'POST' });
    const joined = await sdk.joinById(code, { name: 'Alice' });
    await fetch(url(`/api/rooms/${code}/save?sessionId=${joined.sessionId}`), { method: 'POST' });
    await joined.leave(true);
    await waitRoomGone(code);

    const res = await fetch(url(`/api/rooms/${code}/save`));
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as TableSnapshot;
    expect(snapshot.roomCode).toBe(code);
    expect(snapshot.objects.map((o) => o.id)).toContain('pawn-http');
  });

  it('404s when no snapshot exists', async () => {
    const res = await fetch(url('/api/rooms/ZZZZZ/save'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('400s with SNAPSHOT_VERSION_UNSUPPORTED for a future schema', async () => {
    fs.writeFileSync(
      path.join(savesDir, 'QQQ2Q.json'),
      JSON.stringify({ ...emptySnapshot('QQQ2Q'), schemaVersion: 99 }),
    );
    const res = await fetch(url('/api/rooms/QQQ2Q/save'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('SNAPSHOT_VERSION_UNSUPPORTED');
  });
});

describe('GET /api/saves', () => {
  it('lists saved tables', async () => {
    fs.writeFileSync(path.join(savesDir, 'RRR2R.json'), JSON.stringify(emptySnapshot('RRR2R')));
    const res = await fetch(url('/api/saves'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saves: Array<{ roomCode: string }> };
    expect(body.saves.map((s) => s.roomCode)).toContain('RRR2R');
  });
});

describe('POST /api/rooms/:code/reopen', () => {
  it('404s without a snapshot', async () => {
    const res = await fetch(url('/api/rooms/ZZZZZ/reopen'), { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('409s when the room is already live', async () => {
    const room = await sdk.create('table', { name: 'Alice' });
    const res = await fetch(url(`/api/rooms/${room.roomId}/reopen`), { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ROOM_ALREADY_LIVE');
    await room.leave(true);
    await waitRoomGone(room.roomId);
  });

  it('reopens the table and a client can join the restored room', async () => {
    const { code } = await createRoomWithObject();
    // Persist it: reopen -> join -> host save -> leave -> dispose.
    await fetch(url(`/api/rooms/${code}/reopen`), { method: 'POST' });
    const first = await sdk.joinById(code, { name: 'Alice' });
    await fetch(url(`/api/rooms/${code}/save?sessionId=${first.sessionId}`), { method: 'POST' });
    await first.leave(true);
    await waitRoomGone(code);

    const res = await fetch(url(`/api/rooms/${code}/reopen`), { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; restored: boolean; objects: number };
    expect(body.code).toBe(code);
    expect(body.restored).toBe(true);
    expect(body.objects).toBe(1);

    const joined = await sdk.joinById(code, { name: 'Alice' });
    for (let i = 0; i < 100 && !joined.state?.objects?.has('pawn-http'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(joined.state?.objects?.has('pawn-http')).toBe(true);
    expect(joined.state?.objects?.get('pawn-http')?.assetRef).toBe('risk/pawn-red');
    await joined.leave(true);
    await waitRoomGone(code);
  });
});

function emptySnapshot(code: string): TableSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    roomCode: code,
    createdAt: 1700000000000,
    savedAt: Date.now(),
    objects: [],
    players: [],
    dieValues: {},
  };
}
