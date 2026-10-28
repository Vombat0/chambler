import { describe, expect, it } from 'vitest';
import { GridManager } from './GridManager.js';
import { bindGridToInteraction, type GridBinding, type SnapTargetObject } from './bind.js';
import type { Transform } from '@chambler/shared';

class FakeEmitter {
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  on(event: string, handler: (p: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }
  emit(event: string, payload: unknown): void {
    for (const h of this.listeners.get(event) ?? []) h(payload);
  }
}

function makeObject(kind: string, x: number, z: number, y = 0.5, meta: Record<string, unknown> = {}): {
  mo: SnapTargetObject;
  rigid: { tx: number[][]; vel: number[][] };
} {
  const rigid = { tx: [] as number[][], vel: [] as number[][] };
  const mo: SnapTargetObject = {
    def: { id: 'o', kind, meta },
    mesh: {
      position: { x, y, z },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    body: {
      rigidBody: {
        setTranslation(v) {
          rigid.tx.push([v.x, v.y, v.z]);
          return undefined;
        },
        setLinvel(v) {
          rigid.vel.push([v.x, v.y, v.z]);
          return undefined;
        },
      },
    },
    held: true,
  };
  return { mo, rigid };
}

function fixture() {
  const emitter = new FakeEmitter();
  const store = new Map<string, SnapTargetObject>();
  const grid = new GridManager({ shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 10, rows: 10 } });
  const binding = bindGridToInteraction(grid, {
    emitter: emitter as unknown as GridSnapTargetAdapter['emitter'],
    objects: { get: (id) => store.get(id) },
  });
  return { emitter, store, grid, binding };
}

// structural alias (keeps the fixture above type-simple)
type GridSnapTargetAdapter = Parameters<typeof bindGridToInteraction>[1];

const IDENT: Transform = { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };

describe('bindGridToInteraction — release snap', () => {
  it('snaps a token released within the threshold into the cell center', () => {
    const { emitter, store, grid, binding } = fixture();
    const { mo, rigid } = makeObject('token', 3.2, 2.4);
    store.set('t1', mo);
    mo.def.id = 't1';
    emitter.emit('transformUpdate', { type: 'transformUpdate', id: 't1', transform: IDENT });
    emitter.emit('objectRelease', { objectId: 't1', playerId: 'p1' });
    expect(mo.mesh.position.x).toBeCloseTo(3.5);
    expect(mo.mesh.position.z).toBeCloseTo(2.5);
    expect(rigid.tx[rigid.tx.length - 1]).toEqual([3.5, 0.5, 2.5]);
    expect(binding.stats.snapped).toBe(1);
    expect(grid.occupancy.layerAt({ col: 3, row: 2 }, 'token')).toBe('t1');
    mo.held = false;
    binding.detach();
  });

  it('beyond the threshold the object drops free', () => {
    const { emitter, store, binding } = fixture();
    const { mo } = makeObject('token', 3.2, 2.4);
    store.set('t1', mo);
    mo.def.id = 't1';
    emitter.emit('objectClaim', { objectId: 't1', playerId: 'p1', claimToken: 'x' });
    mo.mesh.position.x = 3.2;
    mo.mesh.position.z = 5.03; // distance to (3.5,4.5) > 0.45
    emitter.emit('objectRelease', { objectId: 't1', playerId: 'p1' });
    expect(mo.mesh.position.x).toBeCloseTo(3.2);
    expect(mo.mesh.position.z).toBeCloseTo(5.03);
    expect(binding.stats.freed).toBe(1);
  });

  it('occupied cell rejects placement and leaves the object free', () => {
    const { emitter, store, grid, binding } = fixture();
    grid.place({ objectId: 'blocker', point: { x: 3.5, z: 2.5 } });
    const { mo } = makeObject('token', 3.6, 2.6);
    store.set('t1', mo);
    mo.def.id = 't1';
    emitter.emit('objectRelease', { objectId: 't1', playerId: 'p1' });
    expect(mo.mesh.position.x).toBeCloseTo(3.6);
    expect(binding.stats.rejected).toBe(1);
    expect(binding.stats.lastRejection).toBe('CELL_OCCUPIED');
    expect(grid.occupancy.layerAt({ col: 3, row: 2 }, 'token')).toBe('blocker');
  });

  it('a tile with meta.edges is snapped and rejected on edge mismatch', () => {
    const { emitter, store, grid, binding } = fixture();
    grid.place({
      objectId: 'nA',
      cell: { col: 3, row: 2 },
      edges: { north: 'grass', east: 'road', south: 'grass', west: 'river' },
    });
    const { mo } = makeObject('tile', 2.4, 2.5, 0.1, {
      edges: { north: 'grass', east: 'road', south: 'grass', west: 'grass' },
    });
    store.set('tilA', mo);
    mo.def.id = 'tilA';
    emitter.emit('objectRelease', { objectId: 'tilA', playerId: 'p1' });
    expect(binding.stats.rejected).toBe(1);
    expect(binding.stats.lastRejection).toBe('EDGE_MISMATCH');

    // matching edge: the target's EAST edge must equal neighbor A's west ('river')
    mo.def.meta = { edges: { north: 'grass', east: 'river', south: 'grass', west: 'grass' } };
    emitter.emit('objectRelease', { objectId: 'tilA', playerId: 'p1' });
    expect(binding.stats.snapped).toBe(1);
    expect(mo.mesh.position.x).toBeCloseTo(2.5);
    expect(grid.occupancy.layerAt({ col: 2, row: 2 }, 'tile')).toBe('tilA');
  });

  it('objectClaim clears the highlight overlay', () => {
    const { emitter, store, grid, binding } = fixture();
    const seen: number[] = [];
    grid.attachHighlightRenderer({
      render: (cells) => seen.push(cells.length),
      clear: () => seen.push(-1),
    });
    const { mo } = makeObject('token', 0.5, 0.5);
    store.set('t1', mo);
    mo.def.id = 't1';
    emitter.emit('transformUpdate', { type: 'transformUpdate', id: 't1', transform: IDENT });
    seen.push(0);
    emitter.emit('objectClaim', { objectId: 't1', playerId: 'p1', claimToken: 'c' });
    expect(seen[seen.length - 1]).toBe(-1);
    binding.detach();
  });

  it('detaching stops listening', () => {
    const { emitter, store, binding } = fixture();
    const { mo } = makeObject('token', 3.2, 2.4);
    store.set('t1', mo);
    mo.def.id = 't1';
    binding.detach();
    emitter.emit('objectRelease', { objectId: 't1', playerId: 'p1' });
    expect(mo.mesh.position.x).toBeCloseTo(3.2);
  });

  it('named board slots win when enabled', () => {
    const emitter = new FakeEmitter();
    const store = new Map<string, SnapTargetObject>();
    const grid = new GridManager(
      { shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 10, rows: 10 } },
      { snapPoints: [{ id: 'go', position: [4, 0, 4] }] },
    );
    const binding: GridBinding = bindGridToInteraction(
      grid,
      { emitter: emitter as unknown as GridSnapTargetAdapter['emitter'], objects: { get: (id) => store.get(id) } },
      { useSlots: true },
    );
    const { mo } = makeObject('pawn', 4.3, 4.2);
    store.set('p1', mo);
    mo.def.id = 'p1';
    emitter.emit('objectRelease', { objectId: 'p1', playerId: 'local' });
    expect(mo.mesh.position.x).toBeCloseTo(4);
    expect(mo.mesh.position.z).toBeCloseTo(4);
    expect(binding.stats.slotPlaced).toBe(1);
    expect(grid.slots.occupant('go')).toBe('p1');
    expect(grid.occupancy.layerAt({ col: 4, row: 4 }, 'token')).toBeUndefined();
  });
});
