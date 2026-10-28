/**
 * B4: NetBridge resync + offline queue tests.
 *
 * Covers the reconnect contract on the client side:
 * - `tableResync` rebuilds the table authoritatively (spawn missing, remove
 *   local-only, refresh def/ownership/transform).
 * - Interpolation buffers are reset so objects land on the resynced pose
 *   without blending pre-disconnect frames (no jump).
 * - Local intents made while offline are queued, then replayed after the
 *   reconnect with server-wins conflict rules.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import type { ObjectDef, TableResyncMessage, Transform } from '@chambler/shared';
import { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { OwnershipTable } from '../object/Ownership.js';
import { NetBridge } from './NetBridge.js';
import type { ObjectManager } from '../object/ObjectManager.js';

const IDENT: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function makeDef(id: string, extra: Partial<ObjectDef> = {}): ObjectDef {
  return {
    id,
    kind: 'pawn',
    assetRef: '',
    transform: { position: { ...IDENT.position }, rotation: { ...IDENT.rotation }, scale: { ...IDENT.scale } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
    ...extra,
  };
}

/** Fake ObjectManager with a REAL OwnershipTable + emitter wiring. */
function makeObjectManager() {
  const emitter = new ObjectEventEmitter();
  const ownership = new OwnershipTable(emitter);
  const objects = new Map<string, any>();
  const om: any = {
    emitter,
    ownership,
    localPlayerId: 'local',
    list: () => Array.from(objects.values()),
    get: (id: string) => objects.get(id),
    spawn: (def: any) => {
      const mo = {
        def: { ...def },
        mesh: { position: { set: vi.fn() }, quaternion: { set: vi.fn() } },
        body: {},
        held: false,
      };
      objects.set(def.id, mo);
      ownership.init(def.id, def.ownerId ?? null);
      emitter.emit('objectSpawn', mo.def);
      return mo;
    },
    remove: (id: string) => {
      const existed = objects.delete(id);
      if (existed) ownership.remove(id);
      return existed;
    },
    updateDef: (id: string, patch: any) => {
      const mo = objects.get(id);
      if (!mo) return;
      mo.def = { ...mo.def, ...patch };
      if (patch.faceUp !== undefined) emitter.emit('flip', { objectId: id, faceUp: patch.faceUp });
    },
    claim: (id: string, playerId?: string) => ownership.claim(id, playerId ?? 'local'),
    release: (id: string, playerId?: string) => ownership.release(id, playerId ?? 'local'),
  };
  return { om: om as unknown as ObjectManager, objects, emitter, ownership };
}

/**
 * Fake NetworkClient with a status machine, an onResync stream, and a
 * swappable room (each reconnect is a new Room instance).
 */
function makeNetClient() {
  const statusCbs: Array<(s: string, a: number) => void> = [];
  let status = 'connected';
  let resyncCb: ((m: TableResyncMessage) => void) | null = null;
  const sent: Array<{ type: string; payload: any }> = [];

  const makeRoom = () => {
    const handlers: Record<string, (m: any) => void> = {};
    const room: any = {
      send: (type: string, payload: any) => sent.push({ type, payload }),
      onMessage: (t: string, cb: any) => {
        handlers[t] = cb;
      },
    };
    return { room, handlers };
  };
  let current = makeRoom();

  const nc: any = {
    getRoom: () => current.room,
    getStatus: () => status,
    onStatus: (cb: any) => {
      statusCbs.push(cb);
      cb(status, 0);
      return () => {};
    },
    onResync: (cb: any) => {
      resyncCb = cb;
      return () => {
        resyncCb = null;
      };
    },
  };
  return {
    nc,
    sent,
    /** Simulates a reconnect handing out a fresh Room instance. */
    newRoom: () => {
      current = makeRoom();
      return current;
    },
    setStatus(s: string): void {
      status = s;
      for (const cb of statusCbs) cb(s, 0);
    },
    resync(objects: ObjectDef[]): void {
      resyncCb?.({ type: 'tableResync', roomCode: 'AB234', objects, serverTime: Date.now() });
    },
  };
}

function makeBridge(localPlayerId = 'local') {
  const ctx = makeObjectManager();
  const net = makeNetClient();
  const bridge = new NetBridge({ localPlayerId, objectManager: ctx.om, networkClient: net.nc });
  bridge.wireLocal();
  return { ...ctx, ...net, net, bridge };
}

describe('NetBridge tableResync (B4)', () => {
  it('spawns missing objects and removes local-only ones (server wins)', () => {
    const { om, net } = makeBridge();
    om.spawn(makeDef('local-only'));
    net.resync([makeDef('srv1'), makeDef('srv2')]);

    expect(om.get('local-only')).toBeUndefined();
    expect(om.get('srv1')).toBeTruthy();
    expect(om.get('srv2')).toBeTruthy();
  });

  it('refreshes def, ownership and transform of existing objects', () => {
    const { om, net } = makeBridge();
    const mo = om.spawn(makeDef('keep', { ownerId: 'local' }));
    const fresh = makeDef('keep', {
      ownerId: 'other',
      faceUp: false,
      kind: 'card',
      transform: {
        position: { x: 7, y: 8, z: 9 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    net.resync([fresh]);

    expect(mo.def.ownerId).toBe('other');
    expect(mo.def.faceUp).toBe(false);
    expect(om.ownership.getOwner('keep')).toBe('other');
    expect(mo.mesh.position.set).toHaveBeenCalledWith(7, 8, 9);
  });

  it('does not echo resync-driven spawns/updates back to the server', () => {
    const { om, net, sent } = makeBridge();
    net.resync([makeDef('srv1'), makeDef('srv2', { faceUp: false, kind: 'card' })]);
    // Every spawn/flip triggered by the resync stays local.
    expect(sent.filter((s) => s.type === 'objectSpawn').length).toBe(0);
    expect(sent.filter((s) => s.type === 'flip').length).toBe(0);
    void om;
  });

  it('resets interpolation so the object lands on the resync pose without a jump', () => {
    const { bridge, net } = makeBridge();
    // Pre-disconnect frames: object was sliding towards x=10.
    bridge.interpolator.push('o', { seq: 1, t: 0, pos: { x: 0, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    bridge.interpolator.push('o', { seq: 2, t: 100, pos: { x: 10, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });

    net.resync([
      makeDef('o', {
        transform: {
          position: { x: 3, y: 0, z: 0 },
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      }),
    ]);

    // Old frames are gone: no interpolation from pre-disconnect positions.
    expect(bridge.interpolator.has('o')).toBe(false);
    expect(bridge.interpolator.sample('o', Date.now() + 5000)).toBeNull();

    // The first fresh frame after the resync renders the new pose directly.
    bridge.interpolator.push('o', { seq: 3, t: Date.now(), pos: { x: 3, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    expect(bridge.interpolator.sample('o', Date.now() + 1000)?.position.x).toBe(3);
  });
});

describe('NetBridge offline queue (B4)', () => {
  it('queues local intents while offline instead of sending them', () => {
    const { bridge, om, net, sent } = makeBridge();
    net.setStatus('reconnecting');

    om.spawn(makeDef('o1'));
    om.updateDef('o1', { faceUp: false });

    expect(sent.length).toBe(0);
    expect(bridge.pendingOfflineIntents).toBe(2);
  });

  it('keeps the queue when the connection is not usable yet', () => {
    const { bridge, om, net, sent } = makeBridge();
    net.setStatus('offline');
    om.spawn(makeDef('o1'));
    net.setStatus('reconnecting'); // back online path, but no resync applied yet
    expect(sent.length).toBe(0);
    expect(bridge.pendingOfflineIntents).toBe(1);
  });

  it('replays a non-conflicting flip after a resync', () => {
    const { om, net, sent, bridge } = makeBridge();
    net.setStatus('reconnecting');
    net.resync([makeDef('shared')]);
    net.setStatus('reconnecting');
    om.updateDef('shared', { faceUp: false });

    net.setStatus('connected');
    const flips = sent.filter((s) => s.type === 'flip');
    expect(flips.length).toBe(1);
    expect(flips[0]!.payload).toEqual({ objectId: 'shared', faceUp: false });
    expect(bridge.pendingOfflineIntents).toBe(0);
  });

  it('drops intents for objects the resync removed, but re-sends their spawn', () => {
    const { om, net, sent } = makeBridge();
    net.setStatus('reconnecting');
    om.spawn(makeDef('gone')); // made offline, server never saw it
    om.updateDef('gone', { faceUp: false });

    // Server does not have 'gone': the resync removes it locally.
    net.resync([makeDef('other')]);
    net.setStatus('connected');

    // The flip is dropped (object gone). The spawn is replayed to recreate it.
    expect(sent.filter((s) => s.type === 'flip').length).toBe(0);
    const spawns = sent.filter((s) => s.type === 'objectSpawn');
    expect(spawns.length).toBe(1);
    expect((spawns[0]!.payload as any).object.id).toBe('gone');
  });

  it('does not echo a replayed spawn back when the server broadcasts it', () => {
    const { om, net, sent, bridge } = makeBridge();
    net.setStatus('reconnecting');
    om.spawn(makeDef('fresh'));

    net.resync([]); // server does not have it
    net.setStatus('connected');
    expect(sent.filter((s) => s.type === 'objectSpawn').length).toBe(1);

    // The server accepted and broadcast the spawn on a NEW room (reconnect);
    // the local re-spawn must not produce a second objectSpawn send (would
    // hit OBJECT_EXISTS).
    const room2 = net.newRoom();
    bridge.wireRemote();
    room2.handlers['objectSpawn']?.({ object: makeDef('fresh') });
    expect(sent.filter((s) => s.type === 'objectSpawn').length).toBe(1);
  });

  it('drops a queued claim when someone else owns the object after the resync', () => {
    const { om, net, sent } = makeBridge();
    net.setStatus('reconnecting');
    om.spawn(makeDef('coin')); // locally free while offline
    expect(om.claim('coin')).toBe(true); // queued claim intent

    // The resync reveals another player claimed it meanwhile.
    net.resync([makeDef('coin', { ownerId: 'other' })]);
    net.setStatus('connected');
    expect(sent.filter((s) => s.type === 'objectClaim').length).toBe(0);
  });

  it('replays a queued claim when the object is still free', () => {
    const { om, net, sent } = makeBridge();
    net.setStatus('reconnecting');
    om.spawn(makeDef('coin'));
    expect(om.claim('coin')).toBe(true);

    net.resync([makeDef('coin')]);
    net.setStatus('connected');
    const claims = sent.filter((s) => s.type === 'objectClaim');
    expect(claims.length).toBe(1);
    expect(claims[0]!.payload).toEqual({ objectId: 'coin' });
  });

  it('replays a queued dieResult only while still the owner', () => {
    const { om, emitter, net, sent } = makeBridge();
    // Case 1: ownership preserved (same-process reconnect) → replayed.
    net.setStatus('reconnecting');
    net.resync([makeDef('die', { kind: 'die', ownerId: 'local' })]);
    net.setStatus('reconnecting');
    emitter.emit('dieResult', { id: 'die', value: 6 });
    net.setStatus('connected');
    expect(sent.filter((s) => s.type === 'dieResult').length).toBe(1);

    // Case 2: ownership lost after a restart (objects restored free) → dropped.
    sent.length = 0;
    net.setStatus('reconnecting');
    emitter.emit('dieResult', { id: 'die', value: 5 });
    net.resync([makeDef('die', { kind: 'die' })]); // ownerId null: server freed it
    net.setStatus('connected');
    expect(sent.filter((s) => s.type === 'dieResult').length).toBe(0);
    void om;
  });

  it('never queues transforms (unreliable channel)', async () => {
    const { bridge, emitter, net } = makeBridge();
    net.setStatus('reconnecting');
    emitter.emitTransformUpdate('o', { ...IDENT, position: { x: 1, y: 0, z: 0 } } as any, undefined, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bridge.pendingOfflineIntents).toBe(0);
  });

  it('bounds the offline queue (newest intents win)', () => {
    const ctx = makeObjectManager();
    const net = makeNetClient();
    const bounded = new NetBridge({
      localPlayerId: 'local',
      objectManager: ctx.om,
      networkClient: net.nc,
      offlineQueueLimit: 2,
    });
    bounded.wireLocal();
    net.setStatus('reconnecting');
    ctx.om.spawn(makeDef('a'));
    ctx.om.spawn(makeDef('b'));
    ctx.om.spawn(makeDef('c'));
    expect(bounded.pendingOfflineIntents).toBe(2);
    expect(ctx.om.list().length).toBe(3);
  });
});
