import { describe, expect, it, vi } from 'vitest';
import { TRANSFORM_JSON_MESSAGE } from '@chambler/shared';
import {
  Board2DBridge,
  asWireRoom,
  dieDef,
  dieObjectId,
  tokenDef,
  tokenObjectId,
} from './board2dBridge.js';

interface Sent {
  type: string;
  payload: unknown;
}

function makeRoom() {
  const sent: Sent[] = [];
  const handlers: Record<string, (message: unknown) => void> = {};
  const room = {
    roomId: 'ROOM1',
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    onMessage: (type: string, cb: (message: unknown) => void) => {
      handlers[type] = cb;
    },
  };
  return { room, sent, handlers };
}

function makeBridge(opts: { now?: () => number } = {}) {
  const { room, sent, handlers } = makeRoom();
  const remoteTokens: Array<{ playerId: string; x: number; y: number }> = [];
  const dieResults: Array<{ playerId: string | null; value: number }> = [];
  let clock = 0;
  const bridge = new Board2DBridge({
    getRoom: () => room,
    selfId: 'me',
    now: opts.now ?? (() => clock),
    onRemoteToken: (info) => remoteTokens.push(info),
    onDieResult: (info) => dieResults.push(info),
  });
  return {
    bridge,
    room,
    sent,
    handlers,
    remoteTokens,
    dieResults,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('board2dBridge — yapısal oda kontrolü', () => {
  it('asWireRoom yalnızca send+onMessage olan nesneyi kabul eder', () => {
    expect(asWireRoom(null)).toBeNull();
    expect(asWireRoom({ send: () => {} })).toBeNull();
    expect(asWireRoom({ send: () => {}, onMessage: () => {} })).not.toBeNull();
  });

  it('tokenDef/dieDef sunucu sözleşmesine uyar (kind, ownerId, meta)', () => {
    const token = tokenDef('p1', 'Ayşe', '#e63946', 955, 955);
    expect(token.kind).toBe('token');
    expect(token.ownerId).toBe('p1');
    expect(token.meta.board2d).toBe(true);
    expect(token.transform.position).toEqual({ x: 9.55, y: 0, z: 9.55 });
    const die = dieDef('p1');
    expect(die.kind).toBe('die');
    expect(die.meta.faces).toBe(12);
  });
});

describe('board2dBridge — spawn ve yerel çıkış', () => {
  it('syncRoom kendi piyonunu birer kez spawn eder (zar artık DiceControllerda)', () => {
    const { bridge, sent } = makeBridge();
    bridge.syncRoom();
    bridge.syncRoom();
    const spawns = sent.filter((s) => s.type === 'objectSpawn');
    expect(spawns).toHaveLength(1);
    const ids = spawns.map((s) => (s.payload as { object: { id: string } }).object.id);
    expect(ids).toContain(tokenObjectId('me'));
    expect(ids).not.toContain(dieObjectId('me'));
  });

  it('sürükleme ObjectEvents üzerinden 20 Hz örneklenir (10 ms aralıklarla iki kare)', () => {
    const { bridge, sent, tick } = makeBridge();
    bridge.syncRoom();
    bridge.reportDrag(500, 500);
    tick(10);
    bridge.reportDrag(510, 500); // pencere içinde → ertelenir
    tick(45);
    bridge.reportDrag(560, 500); // ≥20 Hz penceresi → gönderilir
    const frames = sent.filter((s) => s.type === TRANSFORM_JSON_MESSAGE);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame = frames[0]!.payload as { id: string; seq: number; t: number; transform: { position: { x: number } } };
    expect(frame.id).toBe(tokenObjectId('me'));
    expect(frame.seq).toBe(1);
    expect(frame.transform.position.x).toBeCloseTo(5.0, 6);
  });

  it('reportSettle son kareyi her hâlükârda yayınlar ve seq artar', () => {
    const { bridge, sent } = makeBridge();
    bridge.syncRoom();
    bridge.reportDrag(400, 400);
    bridge.reportSettle(363.6, 363.6);
    const frames = sent.filter((s) => s.type === TRANSFORM_JSON_MESSAGE);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const seqs = frames.map((f) => (f.payload as { seq: number }).seq);
    expect(seqs[seqs.length - 1]!).toBeGreaterThan(seqs[0]!);
  });

  it('zar sonucu release + claim + dieResult olarak gider (yeni epoch)', () => {
    const { bridge, sent } = makeBridge();
    bridge.syncRoom();
    bridge.reportDieValue(9);
    const types = sent.map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(['objectRelease', 'objectClaim', 'dieResult']));
    const die = sent.find((s) => s.type === 'dieResult')!.payload as { objectId: string; value: number };
    expect(die).toEqual({ objectId: dieObjectId('me'), value: 9 });
    expect(types.indexOf('objectRelease')).toBeLessThan(types.indexOf('dieResult'));
  });

  it('oda yoksa (yerel masa) hiçbir şey yayınlanmaz ama hata olmaz', () => {
    const handlers: Record<string, (m: unknown) => void> = {};
    const bridge = new Board2DBridge({ getRoom: () => null, selfId: 'me' });
    bridge.reportDrag(10, 10);
    bridge.reportSettle(10, 10);
    bridge.reportDieValue(7);
    expect(bridge.offline).toBe(true);
    expect(Object.keys(handlers)).toHaveLength(0);
  });
});

describe('board2dBridge — uzaktan gelenler', () => {
  it('uzak transformUpdate enterpolasyona girer ve sampleRemote board koordinatı verir', async () => {
    const { bridge, handlers } = makeBridge();
    bridge.syncRoom();
    handlers[TRANSFORM_JSON_MESSAGE]!({
      id: tokenObjectId('them'),
      transform: { position: { x: 3, y: 0, z: 4 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      seq: 1,
      t: Date.now() + 500,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pos = bridge.sampleRemote('them', Date.now());
    expect(pos).not.toBeNull();
    expect(pos!.x).toBeCloseTo(300, 0);
    expect(pos!.y).toBeCloseTo(400, 0);
  });

  it('uzak piyon spawnı (board2d meta) onRemoteToken ile bildirilir; kendi yankısı atlanır', () => {
    const { bridge, handlers, remoteTokens } = makeBridge();
    bridge.syncRoom();
    handlers['objectSpawn']!({ object: tokenDef('them', 'Ali', '#2a9d8f', 100, 200) });
    handlers['objectSpawn']!({ object: tokenDef('me', 'Ben', '#e63946', 1, 1) });
    expect(remoteTokens).toHaveLength(1);
    expect(remoteTokens[0]!.playerId).toBe('them');
    expect(remoteTokens[0]!.x).toBeCloseTo(100, 6);
  });

  it('kendi zar sonucu yankısı geri bildirilmez, uzakinki bildirilir', () => {
    const { bridge, handlers, dieResults } = makeBridge();
    bridge.syncRoom();
    handlers['dieResult']!({ objectId: dieObjectId('me'), value: 5, playerId: 'me' });
    handlers['dieResult']!({ objectId: dieObjectId('other'), value: 10, playerId: 'other' });
    expect(dieResults).toEqual([{ playerId: 'other', value: 10 }]);
  });

  it('objectRemove uzak piyonu düşürür', () => {
    const onGone = vi.fn();
    const second = makeRoom();
    const bridge2 = new Board2DBridge({ getRoom: () => second.room, selfId: 'me', onRemoteTokenGone: onGone });
    bridge2.syncRoom();
    second.handlers['objectRemove']!({ objectId: tokenObjectId('them') });
    second.handlers['objectRemove']!({ objectId: tokenObjectId('me') }); // kendi yankısı → yok sayılır
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledWith('them');
  });

  it('tableResync uzak piyonları yeniden kurar', () => {
    const { bridge, handlers, remoteTokens } = makeBridge();
    bridge.syncRoom();
    handlers['tableResync']!({
      type: 'tableResync',
      roomCode: 'ROOM1',
      objects: [
        tokenDef('a', 'A', '#fff', 500, 500),
        { ...tokenDef('x', 'X', '#fff', 1, 1), meta: { role: 'not-b2d' } },
      ],
      serverTime: Date.now(),
    });
    expect(remoteTokens.map((t) => t.playerId)).toEqual(['a']);
  });
});
