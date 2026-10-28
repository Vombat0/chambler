/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { decodeTransformBatch, encodeTransformBatch } from '@chambler/shared';
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

  it('sends a binary transformBatch from the local emitter', async () => {
    const { om, emitter } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    const t = { position: { x: 1, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    emitter.emitTransformUpdate('o1', t as any, undefined, 0);
    await new Promise((resolve) => setTimeout(resolve, 5)); // coalesced flush
    const batch = sent.find((s) => s.type === 'transformBatch');
    expect(batch).toBeTruthy();
    expect(batch!.payload).toBeInstanceOf(Uint8Array);
    const frame = decodeTransformBatch(batch!.payload as Uint8Array).frames[0]!;
    expect(frame.position.x).toBeCloseTo(1, 4);
    expect(bridge.sender.idTable.idOf(frame.index)).toBe('o1');
  });

  it('does not send a still object twice', async () => {
    const { om, emitter } = makeObjectManager();
    const { nc, sent } = makeNetClient();
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    const t = { position: { x: 1, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    emitter.emitTransformUpdate('o1', t as any, undefined, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const first = sent.filter((s) => s.type === 'transformBatch').length;
    emitter.resetThrottle();
    emitter.emitTransformUpdate('o1', t as any, undefined, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sent.filter((s) => s.type === 'transformBatch').length).toBe(first);
    expect(bridge.sender.stats.framesSuppressed).toBe(1);
  });

  it('decodes a remote transformBatch into the interpolator', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = { send: () => {}, onMessage: (t: string, cb: any) => { roomHandlers[t] = cb; } };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireRemote();
    // spawn arrives over the wire and carries the server-assigned netIndex
    roomHandlers['objectSpawn']?.({ object: { id: 'r9', kind: 'pawn', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: 'remote', locked: false, faceUp: true, meta: {}, netIndex: 12 } });
    const packet = encodeTransformBatch([
      { index: 12, position: { x: 4, y: 1, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, seq: 3, t: Date.now() },
    ]);
    roomHandlers['transformBatch']?.(packet);
    expect(bridge.interpolator.has('r9')).toBe(true);
    const sampled = bridge.interpolator.sample('r9', Date.now() + 1000);
    expect(sampled!.position.x).toBeCloseTo(4, 4);
  });

  it('ignores a batch for an unknown index', () => {
    const { om } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const room: any = { send: () => {}, onMessage: (t: string, cb: any) => { roomHandlers[t] = cb; } };
    const nc: any = { getRoom: () => room, getStatus: () => 'connected', onStatus: (cb: any) => { cb('connected', 0); return () => {}; } };
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireRemote();
    const packet = encodeTransformBatch([
      { index: 999, position: { x: 4, y: 1, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, seq: 1, t: Date.now() },
    ]);
    expect(() => roomHandlers['transformBatch']?.(packet)).not.toThrow();
    expect(bridge.interpolator.has('unknown')).toBe(false);
  });

  it('sends a local dieResult and applies a remote one', () => {
    const { om, emitter } = makeObjectManager();
    const roomHandlers: Record<string, (m: any) => void> = {};
    const { nc, sent } = makeNetClient();
    (nc.getRoom() as any).onMessage = (t: string, cb: any) => { roomHandlers[t] = cb; };
    om.spawn({ id: 'die', kind: 'die', assetRef: '', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, ownerId: 'local', locked: false, faceUp: true, meta: { faces: 6 } });
    const bridge = new NetBridge({ localPlayerId: 'local', objectManager: om, networkClient: nc });
    bridge.wireLocal();
    bridge.wireRemote();
    emitter.emit('dieResult', { id: 'die', value: 5 });
    expect(sent.find((s) => s.type === 'dieResult')?.payload).toEqual({ objectId: 'die', value: 5 });

    roomHandlers['dieResult']?.({ objectId: 'die', value: 2, faces: 6 });
    expect((om.get('die')!.def.meta as any).dieValue).toBe(2);
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
