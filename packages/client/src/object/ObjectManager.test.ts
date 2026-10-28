import { describe, expect, it } from 'vitest';
import { ObjectManager } from './ObjectManager.js';
import type { ObjectDef } from '@chambler/shared';

function makeDef(kind: ObjectDef['kind'], id = 'o1'): ObjectDef {
  return {
    id,
    kind,
    assetRef: '',
    transform: { position: { x: 0, y: 0.5, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
  };
}

function mockScene() {
  const bodies = new Map<string, unknown>();
  return {
    scene: { add: () => {}, remove: () => {} },
    registerBody: () => {},
    physics: {
      createBody: (id: string, _opts: unknown) => {
        const rb = {
          setBodyType: () => {},
          setTranslation: () => {},
          setRotation: () => {},
          setLinvel: () => {},
          translation: () => ({ x: 0, y: 0, z: 0 }),
          rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
          linvel: () => ({ x: 0, y: 0, z: 0 }),
          angvel: () => ({ x: 0, y: 0, z: 0 }),
        };
        const body = { id, rigidBody: rb, collider: {} };
        bodies.set(id, body);
        return body;
      },
      removeBody: (id: string) => bodies.delete(id),
      readTransform: () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }),
    },
  } as unknown as Record<string, unknown>;
}

describe('ObjectManager', () => {
  it('spawn creates object and emits objectSpawn', () => {
    const sm = mockScene();
    const om = new ObjectManager({ sceneManager: sm, localPlayerId: 'local' });
    let spawned = false;
    om.emitter.on('objectSpawn', () => { spawned = true; });
    const mo = om.spawn(makeDef('die'));
    expect(mo).toBeTruthy();
    expect(om.count()).toBe(1);
    expect(spawned).toBe(true);
  });
  it('flip toggles card faceUp and emits flip', () => {
    const sm = mockScene();
    const om = new ObjectManager({ sceneManager: sm, localPlayerId: 'local' });
    om.spawn(makeDef('card'));
    const faceUpEvents: boolean[] = [];
    om.emitter.on('flip', (e) => faceUpEvents.push(e.faceUp));
    om.flip('o1');
    expect(om.get('o1')!.def.faceUp).toBe(false);
    expect(faceUpEvents).toEqual([false]);
    om.flip('o1');
    expect(om.get('o1')!.def.faceUp).toBe(true);
  });
  it('claim/release ownership', () => {
    const sm = mockScene();
    const om = new ObjectManager({ sceneManager: sm, localPlayerId: 'local' });
    om.spawn(makeDef('pawn'));
    expect(om.claim('o1')).toBe(true);
    expect(om.isLocked('o1')).toBe(false);
    // another player
    expect(om.ownership.claim('o1', 'other')).toBe(false);
    expect(om.release('o1')).toBe(true);
    expect(om.ownership.getOwner('o1')).toBeNull();
  });
  it('locked object cannot be claimed by other', () => {
    const sm = mockScene();
    const om = new ObjectManager({ sceneManager: sm, localPlayerId: 'local' });
    const d = makeDef('die');
    d.ownerId = 'other';
    om.spawn(d);
    expect(om.isLocked('o1', 'local')).toBe(true);
  });
});
