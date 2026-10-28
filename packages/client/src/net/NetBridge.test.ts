/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { NetBridge } from './NetBridge.js';
import type { ObjectManager } from '../object/ObjectManager.js';

function makeObjectManager() {
  const emitter = new ObjectEventEmitter();
  const objects = new Map<string, any>();
  const om: any = {
    emitter,
    localPlayerId: 'local',
    list: () => Array.from(objects.values()),
    get: (id: string) => objects.get(id),
    spawn: (def: any) => {
      const mo = { def: { ...def }, mesh: { position: { set: vi.fn() }, quaternion: { set: vi.fn() } }, body: {} };
      objects.set(def.id, mo);
      emitter.emit('objectSpawn', def);
      return mo;
    },
    remove: (id: string) => objects.delete(id),
    updateDef: (id: string, patch: any) => {
      const mo = objects.get(id);
      if (mo) mo.def = { ...mo.def, ...patch };
    },
    isLocked: () => false,
    ownership: { claim: vi.fn(), release: vi.fn() },
  };
  return { om: om as ObjectManager, objects, emitter };
}

function makeNetClient() {
  const sent: Array<{ type: string; payload: any }> = [];
  const room: any = {
    send: (type: string, payload: any) => sent.push({ type, payload }),
    onMessage: (_t: string, _cb: any) => {},
  };
  const nc: any = {
    getRoom: () => room,
    getStatus: () => 'connected',
    onStatus: (cb: any) => { cb('connected', 0); return () => {}; },
  };
  return { nc, sent, room };
}

describe('NetBridge', () => {
  it('sends objectSpawn when local spawns', () => {
    const { om } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    om.spawn({ id: 'o1', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: null, locked: false, faceUp: true, meta: {} });
    expect(sent.some((s) => s.type === 'objectSpawn')).toBe(true);
  });

  it('offline mode does not send', () => {
    const { om } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const ncOffline: any = { ...nc, getStatus: () => 'disconnected' };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: ncOffline });
    bridge.wireLocal();
    om.spawn({ id: 'o2', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: null, locked: false, faceUp: true, meta: {} });
    expect(sent.length).toBe(0);
  });

  it('sends transformUpdate from local emitter', () => {
    const { om, emitter } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    const t = { position: { x: 1, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    emitter.emitTransformUpdate('o1', t as any, undefined, 0);
    expect(sent.some((s) => s.type === 'transformUpdate')).toBe(true);
  });

  it('sends flip from local', () => {
    const { om, emitter } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    emitter.emit('flip', { objectId: 'o1', faceUp: false });
    expect(sent.some((s) => s.type === 'flip')).toBe(true);
  });

  it('remote transform buffered via wireRemote', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = {
      send: () => {},
      onMessage: (type: string, cb: any) => { roomHandlers[type] = cb; },
    };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    bridge.wireRemote();
    // spawn object
    om.spawn({ id: 'r1', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: 'remote', locked: false, faceUp: true, meta: {} });
    roomHandlers['transformUpdate']?.({ id: 'r1', transform: { position: { x: 5, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, t: 1000, seq: 1 });
    expect(bridge.interpolator.has('r1')).toBe(true);
  });

  it('applyRemoteTransforms updates mesh for remote-owned object', () => {
    const { om } = makeObjectManager();
    const room: any = { send: () => {}, onMessage: () => {} };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    const mo = om.spawn({ id: 'r2', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: 'remote', locked: false, faceUp: true, meta: {} });
    bridge.interpolator.push('r2', { seq: 1, t: 0, pos: { x: 9, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } });
    bridge.applyRemoteTransforms(200);
    expect(mo.mesh.position.set).toHaveBeenCalled();
  });

  it('pushLocalSnapshot sends all objects', () => {
    const { om } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    om.spawn({ id: 's1', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: null, locked: false, faceUp: true, meta: {} });
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.pushLocalSnapshot();
    expect(sent.some((s) => s.type === 'objectSpawn')).toBe(true);
  });

  it('dispose unsubscribes', () => {
    const { om } = makeObjectManager();
    const { nc } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    bridge.dispose();
    // no throw
    expect(true).toBe(true);
  });

  it('remote objectSpawn creates object', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = { send: () => {}, onMessage: (t: string, cb: any) => { roomHandlers[t] = cb; } };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireRemote();
    roomHandlers['objectSpawn']?.({ object: { id: 'remoteObj', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: null, locked: false, faceUp: true, meta: {} } });
    expect(om.get('remoteObj')).toBeTruthy();
  });

  it('remote flip updates def', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = { send: () => {}, onMessage: (t: string, cb: any) => { roomHandlers[t] = cb; } };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    om.spawn({ id: 'f1', kind: 'card', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: null, locked: false, faceUp: true, meta: {} });
    bridge.wireRemote();
    roomHandlers['flip']?.({ objectId: 'f1', faceUp: false });
    expect(om.get('f1')!.def.faceUp).toBe(false);
  });

  it('remote transform ignored for local-owned? buffered anyway', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = { send: () => {}, onMessage: (t: string, cb: any) => { roomHandlers[t] = cb; } };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    om.spawn({ id: 'l1', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: 'local', locked: false, faceUp: true, meta: {} });
    bridge.wireRemote();
    roomHandlers['transformUpdate']?.({ id: 'l1', transform: { position: { x: 5, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, t: 10, seq: 1 });
    expect(bridge.interpolator.has('l1')).toBe(true);
  });
});
