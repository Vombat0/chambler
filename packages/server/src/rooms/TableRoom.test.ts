/**
 * Integration tests for the B1 lobby: real express + Colyseus stack booted with
 * @colyseus/testing, real colyseus.js clients over WebSockets.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { matchMaker } from 'colyseus';
import type { Room as ServerRoom } from 'colyseus';
import type { Room as ClientRoom } from 'colyseus.js';
import { createChamblerServer, type ChamblerServer } from '../app.js';
import { PLAYER_COLORS } from '../lobby/seats.js';
import { ROOM_CODE_ALPHABET } from '../lobby/roomCode.js';
import { TABLE_ROOM_NAME } from './TableRoom.js';
import type { TableState } from './TableState.js';

type ServerTable = ServerRoom<TableState>;
type TestClient = ClientRoom<TableState>;

let chambler: ChamblerServer;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  chambler = createChamblerServer({
    port: 0,
    maxPlayers: 8,
    reconnectionSeconds: 1,
    chatMaxLength: 300,
    chatRateLimit: 3,
    chatRateWindowMs: 1000,
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

function waitUntil(predicate: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timeout waiting for ${label}`));
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
      reject(new Error(`timeout waiting for "${type}"`));
    }, timeoutMs);
    const off = room.onMessage<T>(type, (message) => {
      clearTimeout(timer);
      off();
      resolve(message);
    });
  });
}

async function createTable(): Promise<ServerTable> {
  return colyseus.createRoom<TableState>(TABLE_ROOM_NAME);
}

async function join(room: ServerTable, name: string): Promise<TestClient> {
  return colyseus.connectTo(room, { name });
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const address = chambler.httpServer.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('server is not listening');
  }
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

describe('TableRoom lobby', () => {
  it('creates a table with a 5-character unambiguous code and lobby metadata', async () => {
    const room = await createTable();
    expect(room.roomId).toBe(room.state.code);
    expect(room.state.code).toHaveLength(5);
    for (const character of room.state.code) {
      expect(ROOM_CODE_ALPHABET).toContain(character);
    }
    expect(room.state.maxPlayers).toBe(8);
    expect(room.maxClients).toBe(8);
    expect(room.state.createdAt).toBeGreaterThan(0);
    expect(room.state.players.size).toBe(0);
  });

  it('seats the first player as host, seat 0, palette colour', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const player = room.state.players.get(alice.sessionId);
    expect(player).toBeDefined();
    expect(player?.name).toBe('Alice');
    expect(player?.seat).toBe(0);
    expect(player?.isHost).toBe(true);
    expect(PLAYER_COLORS).toContain(player?.color);
    expect(room.state.hostId).toBe(alice.sessionId);
  });

  it('gives the second player a different seat and colour', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const first = room.state.players.get(alice.sessionId);
    const second = room.state.players.get(bob.sessionId);
    expect(second?.seat).toBe(1);
    expect(second?.color).not.toBe(first?.color);
    expect(second?.isHost).toBe(false);
    expect(room.state.hostId).toBe(alice.sessionId);
  });

  it('notifies the table when a player joins and leaves', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const joinNotice = nextMessage<{ type: string; player: { id: string; name: string } }>(
      alice,
      'join',
    );
    const bob = await join(room, 'Bob');
    const notice = await joinNotice;
    expect(notice.type).toBe('join');
    expect(notice.player).toMatchObject({ id: bob.sessionId, name: 'Bob' });

    const leaveNotice = nextMessage<{ type: string; playerId: string }>(alice, 'leave');
    await bob.leave();
    const left = await leaveNotice;
    expect(left).toEqual({ type: 'leave', playerId: bob.sessionId });
    await waitUntil(() => room.state.players.size === 1, 'bob removed');
  });

  it('hands the host role to the oldest remaining player', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const carol = await join(room, 'Carol');

    await alice.leave();
    await waitUntil(() => !room.state.players.has(alice.sessionId), 'alice removed');

    expect(room.state.hostId).toBe(bob.sessionId);
    expect(room.state.players.get(bob.sessionId)?.isHost).toBe(true);
    expect(room.state.players.get(carol.sessionId)?.isHost).toBe(false);
  });

  it('rejects a ninth player when the table is full', async () => {
    const room = await createTable();
    for (let index = 0; index < 8; index += 1) {
      await join(room, `Player ${index + 1}`);
    }
    expect(room.state.players.size).toBe(8);
    expect(new Set([...room.state.players.values()].map((p) => p.seat)).size).toBe(8);
    expect(new Set([...room.state.players.values()].map((p) => p.color)).size).toBe(8);

    await expect(colyseus.connectTo(room, { name: 'Ninth' })).rejects.toThrow(/locked|max/i);
    expect(room.state.players.size).toBe(8);
  });

  it('rejects invalid player names', async () => {
    const room = await createTable();
    // Keep one player connected: an empty room is disposed immediately.
    await join(room, 'Alice');
    await expect(colyseus.connectTo(room, { name: '' })).rejects.toThrow(/NAME_REQUIRED/);
    await expect(colyseus.connectTo(room, {})).rejects.toThrow(/NAME_REQUIRED/);
    await expect(colyseus.connectTo(room, { name: 'bad\u0000name' })).rejects.toThrow(/NAME_INVALID/);
    await expect(colyseus.connectTo(room, { name: 'x'.repeat(25) })).rejects.toThrow(
      /NAME_TOO_LONG/,
    );
    expect(room.state.players.size).toBe(1);
  });

  it('makes duplicate names unique instead of rejecting them', async () => {
    const room = await createTable();
    const first = await join(room, 'Alice');
    const second = await join(room, 'alice');
    expect(room.state.players.get(first.sessionId)?.name).toBe('Alice');
    expect(room.state.players.get(second.sessionId)?.name).toBe('alice 2');
  });

  it('joins by room code and reports a clear error for unknown codes', async () => {
    const owner = await colyseus.sdk.create<TableState>(TABLE_ROOM_NAME, { name: 'Owner' });
    await waitUntil(() => {
      const state = owner.state as TableState | undefined;
      return typeof state?.code === 'string' && state.code.length === 5;
    }, 'owner state');
    const code = owner.state.code;

    const guest = await colyseus.sdk.joinById<TableState>(code, { name: 'Guest' });
    await waitUntil(() => {
      const state = guest.state as Partial<TableState> | undefined;
      return (state?.players?.size ?? 0) === 2;
    }, 'guest in room');

    await expect(colyseus.sdk.joinById('ZZZZZ', { name: 'Nobody' })).rejects.toThrow(
      /not found/i,
    );

    const found = await getJson(`/api/rooms/${code}`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ code, roomId: code, maxPlayers: 8 });
    expect((found.body as { players: unknown[] }).players).toHaveLength(2);

    const lowerCase = await getJson(`/api/rooms/${code.toLowerCase()}`);
    expect(lowerCase.status).toBe(200);

    const missing = await getJson('/api/rooms/ZZZZZ');
    expect(missing.status).toBe(404);
    expect((missing.body as { error: string }).error).toBe('ROOM_NOT_FOUND');

    const malformed = await getJson('/api/rooms/ABC');
    expect(malformed.status).toBe(400);
    expect((malformed.body as { error: string }).error).toBe('ROOM_CODE_INVALID');
  });

  it('lets a player take a free seat and rejects taken or invalid seats', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');

    const takenError = nextMessage<{ code: string }>(alice, 'error');
    alice.send('seat', { seat: 1 });
    expect((await takenError).code).toBe('SEAT_TAKEN');
    expect(room.state.players.get(alice.sessionId)?.seat).toBe(0);

    const invalidError = nextMessage<{ code: string }>(alice, 'error');
    alice.send('seat', { seat: 99 });
    expect((await invalidError).code).toBe('SEAT_INVALID');

    alice.send('seat', { seat: 5 });
    await waitUntil(() => room.state.players.get(alice.sessionId)?.seat === 5, 'seat changed');
    expect(room.state.players.get(bob.sessionId)?.seat).toBe(1);
  });

  it('lets a player pick a free colour and rejects taken or unknown colours', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    const aliceColor = room.state.players.get(alice.sessionId)?.color ?? '';
    const freeColor = PLAYER_COLORS.find((color) => color !== aliceColor) ?? PLAYER_COLORS[1];

    const takenError = nextMessage<{ code: string }>(bob, 'error');
    bob.send('color', { color: aliceColor });
    expect((await takenError).code).toBe('COLOR_TAKEN');

    const invalidError = nextMessage<{ code: string }>(bob, 'error');
    bob.send('color', { color: '#123456' });
    expect((await invalidError).code).toBe('COLOR_INVALID');

    bob.send('color', { color: freeColor.toUpperCase() });
    await waitUntil(
      () => room.state.players.get(bob.sessionId)?.color === freeColor,
      'colour changed',
    );
  });

  it('broadcasts chat messages to every player with the shared message shape', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');

    const forAlice = nextMessage<{ type: string; playerId: string; text: string; sentAt: number }>(
      alice,
      'chat',
    );
    const forBob = nextMessage<{ type: string; playerId: string; text: string; sentAt: number }>(
      bob,
      'chat',
    );
    alice.send('chat', { text: '  hello   table  ' });

    const [own, other] = await Promise.all([forAlice, forBob]);
    expect(own).toMatchObject({ type: 'chat', playerId: alice.sessionId, text: 'hello table' });
    expect(other.text).toBe('hello table');
    expect(other.sentAt).toBeGreaterThan(0);
  });

  it('starts the table when the host asks and rejects non-host attempts', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const bob = await join(room, 'Bob');
    expect(room.state.started).toBe(false);

    const rejection = nextMessage<{ code: string }>(bob, 'error');
    bob.send('tableStart', {});
    expect((await rejection).code).toBe('HOST_ONLY');
    expect(room.state.started).toBe(false);

    alice.send('tableStart', {});
    await waitUntil(() => room.state.started === true, 'table started');

    // Idempotent: starting again changes nothing (no error, no state churn).
    let sawError = false;
    const offError = alice.onMessage('error', () => { sawError = true; });
    alice.send('tableStart', {});
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    offError();
    expect(sawError).toBe(false);
    expect(room.state.started).toBe(true);
  });

  it('replays the recent chat history to a player joining later', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    alice.send('chat', { text: 'first message' });
    alice.send('chat', { text: 'second message' });

    const bob = await join(room, 'Bob');
    const history = await nextMessage<{
      messages: Array<{ playerId: string; playerName: string; text: string; sentAt: number }>;
    }>(bob, 'chatHistory');
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({
      playerId: alice.sessionId,
      playerName: 'Alice',
      text: 'first message',
    });
    expect(history.messages[1]).toMatchObject({
      playerId: alice.sessionId,
      playerName: 'Alice',
      text: 'second message',
    });
    expect(history.messages[1].sentAt).toBeGreaterThanOrEqual(history.messages[0].sentAt);
  });

  it('rate-limits chat to 3 messages per second', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');
    const received: string[] = [];
    alice.onMessage<{ text: string }>('chat', (message) => received.push(message.text));

    const rateLimitError = nextMessage<{ code: string }>(alice, 'error');
    for (let index = 0; index < 4; index += 1) {
      alice.send('chat', { text: `m${index}` });
    }
    expect((await rateLimitError).code).toBe('CHAT_RATE_LIMITED');
    await waitUntil(() => received.length >= 3, 'first three chats');
    expect(received).toEqual(['m0', 'm1', 'm2']);
  });

  it('ignores unknown messages and malformed payloads without breaking the room', async () => {
    const room = await createTable();
    const alice = await join(room, 'Alice');

    alice.send('bogus', { anything: true });
    alice.send('chat', 'not-an-object');
    alice.send('seat', { seat: 'first' });
    alice.send('color', { color: 42 });

    const invalidChat = nextMessage<{ code: string }>(alice, 'error');
    alice.send('chat', { text: 42 });
    expect((await invalidChat).code).toBe('CHAT_INVALID');

    const chat = nextMessage<{ text: string }>(alice, 'chat');
    alice.send('chat', { text: 'still alive' });
    expect((await chat).text).toBe('still alive');
    expect(room.state.players.size).toBe(1);
  });

  it('disposes the room when the last player leaves', async () => {
    const room = await createTable();
    const code = room.state.code;
    const alice = await join(room, 'Alice');
    await alice.leave();
    await waitUntil(() => matchMaker.getLocalRoomById(code) === undefined, 'room disposed', 5000);
  });

  it('keeps the /health endpoint working', async () => {
    const health = await colyseus.http.get('/health');
    expect(health.statusCode).toBe(200);
    expect(health.data).toMatchObject({ status: 'ok', service: 'chambler-server' });
  });
});
