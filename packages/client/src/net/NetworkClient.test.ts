/**
 * B4: NetworkClient reconnection + persistence API tests.
 *
 * Uses a fake colyseus.js SDK (joinById/create/reconnect) and a fake fetch —
 * no sockets. The status machine under test:
 *
 *   connecting → connected                     (fresh join)
 *   reconnecting → resyncing → connected       (token / rejoin / reopen)
 *   reconnecting → offline                     (attempts exhausted)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkClient, HttpError, type SdkLike } from './NetworkClient.js';

interface FakeRoom {
  roomId: string;
  sessionId: string;
  reconnectionToken: string;
  send: ReturnType<typeof vi.fn>;
  onMessage: (type: string, cb: (message: unknown) => void) => void;
  onLeave: (cb: () => void) => void;
  onError: (cb: (...args: unknown[]) => void) => void;
  leave: ReturnType<typeof vi.fn>;
  fire: (type: string, message: unknown) => void;
  drop: () => void;
}

function makeFakeRoom(roomId = 'AB234'): FakeRoom {
  const handlers = new Map<string, (message: unknown) => void>();
  let leaveCb: (() => void) | null = null;
  const room: FakeRoom = {
    roomId,
    sessionId: `sess-${roomId}`,
    reconnectionToken: `tok-${roomId}`,
    send: vi.fn(),
    onMessage: (type, cb) => {
      handlers.set(type, cb);
    },
    onLeave: (cb) => {
      leaveCb = cb;
    },
    onError: vi.fn(),
    leave: vi.fn().mockResolvedValue(undefined),
    fire: (type, message) => handlers.get(type)?.(message),
    drop: () => leaveCb?.(),
  };
  return room;
}

type SdkMethod = 'joinById' | 'create' | 'reconnect';

function makeSdk() {
  const calls: Array<{ method: SdkMethod; args: unknown[] }> = [];
  const rooms: FakeRoom[] = [];
  /** Methods that should fail, and how many upcoming calls to fail. */
  const failNext: Partial<Record<SdkMethod, number>> = {};
  const shouldFail = (method: SdkMethod): boolean => {
    const left = failNext[method] ?? 0;
    if (left > 0) {
      failNext[method] = left - 1;
      return true;
    }
    return false;
  };
  const sdk: SdkLike = {
    joinById: (async (roomId: string, options?: Record<string, unknown>) => {
      calls.push({ method: 'joinById', args: [roomId, options] });
      if (shouldFail('joinById')) throw new Error('join failed');
      const room = makeFakeRoom(roomId);
      rooms.push(room);
      return room as any;
    }) as SdkLike['joinById'],
    create: (async (roomName: string, options?: Record<string, unknown>) => {
      calls.push({ method: 'create', args: [roomName, options] });
      if (shouldFail('create')) throw new Error('create failed');
      const room = makeFakeRoom('CDE45');
      rooms.push(room);
      return room as any;
    }) as SdkLike['create'],
    reconnect: (async (token: string) => {
      calls.push({ method: 'reconnect', args: [token] });
      if (shouldFail('reconnect')) throw new Error('reconnect failed');
      const room = makeFakeRoom('RECON');
      rooms.push(room);
      return room as any;
    }) as SdkLike['reconnect'],
  };
  return {
    sdk,
    calls,
    rooms,
    /** Fails the next `times` calls of `method` (default: all of them). */
    fail(method: SdkMethod, times = Number.POSITIVE_INFINITY): void {
      failNext[method] = times;
    },
  };
}

function makeFetch() {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses: Array<{ status: number; body: unknown }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    } as Response;
  });
  return {
    fetchImpl: impl as unknown as typeof fetch,
    requests,
    respond(status: number, body: unknown): void {
      responses.push({ status, body });
    },
    /** Simulates total network failure (server unreachable). */
    failAll(): void {
      impl.mockImplementation(async () => {
        throw new Error('network down');
      });
    },
  };
}

function makeClient(sdk: SdkLike, fetchImpl: typeof fetch, opts: Record<string, unknown> = {}) {
  return new NetworkClient({
    url: 'ws://localhost:1234',
    sdk,
    fetchImpl,
    ...opts,
  });
}

const resyncMessage = (roomCode: string, serverTime = 1) => ({
  type: 'tableResync' as const,
  roomCode,
  objects: [],
  serverTime,
});

describe('NetworkClient (B4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins by code and reports connected, forwarding tableResync to listeners', async () => {
    const s = makeSdk();
    const nc = makeClient(s.sdk, makeFetch().fetchImpl);
    const statuses: string[] = [];
    nc.onStatus((st) => statuses.push(st));
    const resyncs: unknown[] = [];
    nc.onResync((m) => resyncs.push(m));

    const room = await nc.join('AB234', 'ayla');
    expect(room.roomId).toBe('AB234');
    expect(nc.getStatus()).toBe('connected');
    expect(nc.getRoom()).toBe(room);

    const message = resyncMessage('AB234');
    s.rooms[0]!.fire('tableResync', message);
    expect(resyncs).toEqual([message]);
    // A fresh join is already 'connected'; the resync must not downgrade it.
    expect(nc.getStatus()).toBe('connected');
  });

  it('reconnects with the reconnection token and goes resyncing → connected', async () => {
    const s = makeSdk();
    const nc = makeClient(s.sdk, makeFetch().fetchImpl);
    const statuses: string[] = [];
    nc.onStatus((st) => statuses.push(st));
    await nc.join('AB234', 'ayla');

    s.rooms[0]!.drop(); // connection lost
    expect(nc.getStatus()).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1000); // first retry delay
    const reconnectCall = s.calls.find((c) => c.method === 'reconnect');
    expect(reconnectCall?.args[0]).toBe('tok-AB234');
    expect(nc.getStatus()).toBe('resyncing');

    s.rooms[s.rooms.length - 1]!.fire('tableResync', resyncMessage('AB234', 2));
    expect(nc.getStatus()).toBe('connected');
    expect(statuses).toEqual(
      expect.arrayContaining(['connecting', 'connected', 'reconnecting', 'resyncing', 'connected']),
    );
  });

  it('falls back to joinById when the token is rejected (room still live)', async () => {
    const s = makeSdk();
    s.fail('reconnect');
    const nc = makeClient(s.sdk, makeFetch().fetchImpl);
    await nc.join('AB234', 'ayla');

    s.rooms[0]!.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.calls.some((c) => c.method === 'reconnect')).toBe(true);
    expect(s.calls.some((c) => c.method === 'joinById' && c.args[0] === 'AB234')).toBe(true);
    expect(nc.getStatus()).toBe('resyncing');
    s.rooms[s.rooms.length - 1]!.fire('tableResync', resyncMessage('AB234', 3));
    expect(nc.getStatus()).toBe('connected');
  });

  it('reopens from a durable save when the server restarted (token and join fail)', async () => {
    const s = makeSdk();
    const http = makeFetch();
    const nc = makeClient(s.sdk, http.fetchImpl);
    await nc.createAndJoin('ayla'); // room CDE45
    s.fail('reconnect'); // token invalid after a restart
    s.fail('joinById', 1); // room gone in the new process

    s.rooms[0]!.drop();
    http.respond(200, { code: 'CDE45', restored: true });
    await vi.advanceTimersByTimeAsync(1000);

    const reopen = http.requests.find((r) => r.url.includes('/api/rooms/CDE45/reopen'));
    expect(reopen).toBeTruthy();
    expect(reopen?.init?.method).toBe('POST');
    // joinById succeeded on the second call (after the reopen).
    const joins = s.calls.filter((c) => c.method === 'joinById' && c.args[0] === 'CDE45');
    expect(joins.length).toBe(2);
    expect(nc.getStatus()).toBe('resyncing');
    s.rooms[s.rooms.length - 1]!.fire('tableResync', resyncMessage('CDE45', 4));
    expect(nc.getStatus()).toBe('connected');
  });

  it('reports offline after exhausting reconnect attempts', async () => {
    const s = makeSdk();
    const http = makeFetch();
    const nc = makeClient(s.sdk, http.fetchImpl, { maxReconnectAttempts: 2 });
    await nc.createAndJoin('ayla');
    s.fail('reconnect');
    s.fail('joinById');
    http.failAll();

    s.rooms[0]!.drop();
    await vi.advanceTimersByTimeAsync(1000); // attempt 1
    expect(nc.getStatus()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2000); // attempt 2
    await vi.advanceTimersByTimeAsync(4000); // no attempts left
    expect(nc.getStatus()).toBe('offline');
  });

  it('leave() cancels pending reconnection', async () => {
    const s = makeSdk();
    const nc = makeClient(s.sdk, makeFetch().fetchImpl);
    await nc.createAndJoin('ayla');
    s.fail('reconnect');
    s.fail('joinById');

    s.rooms[0]!.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(nc.getStatus()).not.toBe('connected');

    await nc.leave();
    expect(nc.getStatus()).toBe('idle');
    const reconnectCalls = s.calls.filter((c) => c.method === 'reconnect').length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls.filter((c) => c.method === 'reconnect').length).toBe(reconnectCalls);
  });

  it('createAndJoin remembers the code so a reconnect can rejoin it', async () => {
    const s = makeSdk();
    s.fail('reconnect');
    const nc = makeClient(s.sdk, makeFetch().fetchImpl);
    await nc.createAndJoin('ayla');
    s.rooms[0]!.drop();
    await vi.advanceTimersByTimeAsync(1000);
    const rejoin = s.calls.find((c) => c.method === 'joinById');
    expect(rejoin?.args[0]).toBe('CDE45');
    expect(rejoin?.args[1]).toEqual({ name: 'ayla' });
  });

  /* ---------------------------- persistence API ---------------------------- */

  it('saveRoom POSTs with the sessionId and maps the result', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(200, { code: 'AB234', savedAt: 123, bytes: 456, objects: 7 });
    const nc = makeClient(s.sdk, http.fetchImpl);
    const result = await nc.saveRoom('AB234', 'sess-1');
    expect(result).toEqual({ code: 'AB234', savedAt: 123, bytes: 456, objects: 7 });
    const req = http.requests[0]!;
    expect(req.url).toBe('http://localhost:1234/api/rooms/AB234/save?sessionId=sess-1');
    expect(req.init?.method).toBe('POST');
  });

  it('saveRoom surfaces the server error code (NOT_HOST)', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(403, { error: 'NOT_HOST', message: 'Only the host can force a save.' });
    const nc = makeClient(s.sdk, http.fetchImpl);
    await expect(nc.saveRoom('AB234', 'wrong')).rejects.toMatchObject({
      status: 403,
      code: 'NOT_HOST',
    });
  });

  it('listSaves returns the save summaries', async () => {
    const s = makeSdk();
    const http = makeFetch();
    const saves = [{ roomCode: 'AB234', savedAt: 1, bytes: 10, objects: 2 }];
    http.respond(200, { saves });
    const nc = makeClient(s.sdk, http.fetchImpl);
    await expect(nc.listSaves()).resolves.toEqual(saves);
    expect(http.requests[0]!.url).toBe('http://localhost:1234/api/saves');
  });

  it('getRoomSnapshot returns the snapshot json', async () => {
    const s = makeSdk();
    const http = makeFetch();
    const snapshot = { schemaVersion: 1, roomCode: 'AB234', objects: [] };
    http.respond(200, snapshot);
    const nc = makeClient(s.sdk, http.fetchImpl);
    await expect(nc.getRoomSnapshot('AB234')).resolves.toEqual(snapshot);
  });

  it('getRoomSnapshot throws HttpError on unsupported version', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(400, { error: 'SNAPSHOT_VERSION_UNSUPPORTED', message: 'old save' });
    const nc = makeClient(s.sdk, http.fetchImpl);
    const err = await nc.getRoomSnapshot('AB234').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe('SNAPSHOT_VERSION_UNSUPPORTED');
  });

  it('openFromSnapshot reopens a saved room and joins it', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(200, { code: 'AB234', restored: true });
    const nc = makeClient(s.sdk, http.fetchImpl);
    const room = await nc.openFromSnapshot('AB234', 'ayla');
    expect(room.roomId).toBe('AB234');
    expect(http.requests[0]!.url).toBe('http://localhost:1234/api/rooms/AB234/reopen');
    expect(s.calls.some((c) => c.method === 'joinById' && c.args[0] === 'AB234')).toBe(true);
    expect(nc.getStatus()).toBe('connected');
  });

  it('openFromSnapshot treats 409 (already live) as joinable', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(409, { error: 'ROOM_ALREADY_LIVE' });
    const nc = makeClient(s.sdk, http.fetchImpl);
    await expect(nc.openFromSnapshot('AB234', 'ayla')).resolves.toBeTruthy();
  });

  it('openFromSnapshot propagates missing saves', async () => {
    const s = makeSdk();
    const http = makeFetch();
    http.respond(404, { error: 'SNAPSHOT_NOT_FOUND', message: 'no save' });
    const nc = makeClient(s.sdk, http.fetchImpl);
    await expect(nc.openFromSnapshot('AB234', 'ayla')).rejects.toMatchObject({
      status: 404,
      code: 'SNAPSHOT_NOT_FOUND',
    });
    expect(s.calls.some((c) => c.method === 'joinById')).toBe(false);
  });
});
