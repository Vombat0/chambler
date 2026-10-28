import { describe, expect, it } from 'vitest';
import {
  GridManager,
  MAX_HIGHLIGHT_CELLS,
  parseTileEdges,
  type HighlightCell,
  type HighlightRendererLike,
  type PlacedTile,
  type SnapResult,
} from './GridManager.js';
import type { TileEdges } from './TileEdges.js';

function makeGrid(snapPoints: { id: string; position: [number, number, number] }[] = []) {
  return new GridManager(
    { shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 10, rows: 10 } },
    { snapPoints },
  );
}

function fakeRenderer(): HighlightRendererLike & { rendered: HighlightCell[][]; clears: number } {
  const rendered: HighlightCell[][] = [];
  let clears = 0;
  return {
    rendered,
    get clears() {
      return clears;
    },
    render(cells: HighlightCell[], _cellSize: number): void {
      rendered.push(cells);
    },
    clear(): void {
      clears += 1;
    },
  };
}

describe('GridManager — snap threshold (45% of cellSize)', () => {
  const gm = makeGrid();

  it('inside threshold snaps to the containing cell center', () => {
    const r = gm.snapCheck({ x: 0.4, z: 0.2 });
    expect(r.ok).toBe(true);
    if (r.ok && r.center) {
      expect(r.cell).toEqual({ col: 0, row: 0 });
      expect(r.center).toEqual({ x: 0.5, z: 0.5 });
      expect(Math.hypot(0.4 - 0.5, 0.2 - 0.5)).toBeCloseTo(Math.hypot(r.center.x - 0.4, r.center.z - 0.2));
    }
  });

  it('exactly at the 45% mark still snaps; beyond it the object drops free', () => {
    const at: SnapResult = gm.snapCheck({ x: 0.95, z: 0.5 });
    expect(at.ok).toBe(true);
    expect(at.distance).toBeCloseTo(0.45);
    const out: SnapResult = gm.snapCheck({ x: 0.97, z: 0.5 });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('SNAP_TOO_FAR');
  });

  it('outside the grid bounds never snaps', () => {
    expect(gm.snapCheck({ x: 100, z: 100 }).reason).toBe('CELL_OUT_OF_BOUNDS');
  });
});

describe('GridManager — place/remove/occupancy', () => {
  it('place resolves the point into a cell and registers occupancy', () => {
    const gm = makeGrid();
    const r = gm.place({ objectId: 't1', point: { x: 3.4, z: 2.6 } });
    expect(r.ok).toBe(true);
    expect(r.cell).toEqual({ col: 3, row: 2 });
    expect(r.center).toEqual({ x: 3.5, z: 2.5 });
    expect(gm.occupancy.layerAt({ col: 3, row: 2 }, 'token')).toBe('t1');
  });

  it('place rejects an occupied cell with a reason', () => {
    const gm = makeGrid();
    gm.place({ objectId: 'a', point: { x: 0.5, z: 0.5 } });
    const r = gm.place({ objectId: 'b', point: { x: 0.5, z: 0.5 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('CELL_OCCUPIED');
  });

  it('place out of bounds is rejected', () => {
    const gm = makeGrid();
    expect(gm.place({ objectId: 'x', point: { x: 99, z: 0 } }).reason).toBe('CELL_OUT_OF_BOUNDS');
  });

  it('remove frees the cell and clears tile registration', () => {
    const gm = makeGrid();
    gm.place({ objectId: 'a', cell: { col: 1, row: 1 } });
    const r = gm.remove('a');
    expect(r.cell).toEqual({ col: 1, row: 1 });
    expect(gm.occupancy.layerAt({ col: 1, row: 1 }, 'token')).toBeUndefined();
    expect(gm.remove('a').cell).toBeNull();
  });

  it('multi-layer placement: a tile and a token may share one cell', () => {
    const gm = makeGrid();
    expect(gm.place({ objectId: 'tile1', kind: 'tile', cell: { col: 4, row: 4 } }).ok).toBe(true);
    expect(gm.place({ objectId: 'tok1', kind: 'token', cell: { col: 4, row: 4 } }).ok).toBe(true);
    expect(gm.occupancy.layerAt({ col: 4, row: 4 }, 'tile')).toBe('tile1');
    expect(gm.occupancy.layerAt({ col: 4, row: 4 }, 'token')).toBe('tok1');
  });
});

describe('GridManager — tile edge matching across the four rotations', () => {
  it('explicit rotation check: A rotated 90 faces west with its old SOUTH value', () => {
    const src: TileEdges = { north: 'building', east: 'road', south: 'field', west: 'stream' };
    // A is placed EAST of the target cell (2,3): the target's EAST edge must
    // match A's WEST face. After 90° cw rotation, A's west face shows its old
    // SOUTH value = 'field' (independently written expectation).
    const gm = makeGrid();
    gm.place({ objectId: 'A', cell: { col: 3, row: 3 }, edges: src, rotation: 90 });
    expect(gm.canPlace({ col: 2, row: 3 }, 'tile', { north: 'a', east: 'road', south: 'c', west: 'd' }, 0).ok).toBe(false);
    expect(gm.canPlace({ col: 2, row: 3 }, 'tile', { north: 'a', east: 'field', south: 'c', west: 'd' }, 0).ok).toBe(true);
    expect(gm.placedTileOf('A')?.rotation).toBe(90);
  });

  it('all four rotations: matched edge accepts, mismatched edge rejects', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const gm = makeGrid();
      const src: TileEdges = { north: 'valine', east: 'veline', south: 'vsline', west: 'vwline' };
      gm.place({ objectId: 'A', cell: { col: 3, row: 3 }, edges: src, rotation: rot });
      // A (east neighbor) shows manual(src, rot).west toward the target
      const requiredEast = manual(src, rot).west;
      const good: TileEdges = { north: 'x1', east: requiredEast, south: 'x3', west: 'x4' };
      expect(gm.canPlace({ col: 2, row: 3 }, 'tile', good, 0).ok).toBe(true);
      const bad: TileEdges = { north: good.north, east: requiredEast + '!', south: good.south, west: good.west };
      expect(gm.canPlace({ col: 2, row: 3 }, 'tile', bad, 0).reason).toBe('EDGE_MISMATCH');
    }
  });

  it('placed tile rotation is remembered: moving the neighbor updates checks', () => {
    const gm = makeGrid();
    const src: TileEdges = { north: 'p', east: 'q', south: 'r', west: 's' };
    gm.place({ objectId: 'A', cell: { col: 3, row: 3 }, edges: src, rotation: 180 });
    // A rotated 180: west face shows its old east value 'q'
    const tile: PlacedTile | undefined = gm.placedTileOf('A');
    expect(tile?.rotation).toBe(180);
    expect(gm.canPlace({ col: 2, row: 3 }, 'tile', { north: 'a', east: 'q', south: 'c', west: 'd' }, 0).ok).toBe(true);
  });

  it('edge matching is unsupported on hex grids', () => {
    const gm = new GridManager({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, bounds: { radius: 3 } });
    expect(
      gm.canPlace({ col: 0, row: 0 }, 'tile', { north: 'a', east: 'b', south: 'c', west: 'd' }).reason,
    ).toBe('HEX_EDGES_UNSUPPORTED');
  });

  function manual(base: TileEdges, rot: 0 | 90 | 180 | 270): TileEdges {
    const seq = { north: base.north, east: base.east, south: base.south, west: base.west };
    const list = [seq.north, seq.east, seq.south, seq.west];
    const shift = rot / 90;
    const take = (i: number) => list[(i - shift + 4) % 4]!;
    return { north: take(0), east: take(1), south: take(2), west: take(3) };
  }
});

describe('GridManager — board slots', () => {
  const slots = [
    { id: 'go', position: [0, 0, 0] as [number, number, number] },
    { id: 'jail', position: [4, 0, 4] as [number, number, number] },
  ];

  it('placeInSlot tracks occupancy by name', () => {
    const gm = makeGrid(slots);
    expect(gm.placeInSlot('go', 'pawn1').ok).toBe(true);
    expect(gm.placeInSlot('go', 'pawn2').ok).toBe(false);
    expect(gm.placeInSlot('missing', 'pawn2').ok).toBe(false);
    expect(gm.slots.occupant('go')).toBe('pawn1');
    expect(gm.slots.slotOf('pawn1')).toBe('go');
    expect(gm.remove('pawn1').slotId).toBe('go');
    expect(gm.slots.occupant('go')).toBeUndefined();
  });
});

describe('GridManager — highlight', () => {
  it('highlight labels cells valid/invalid and forwards them to the renderer', () => {
    const gm = makeGrid();
    const r = fakeRenderer();
    gm.attachHighlightRenderer(r);
    gm.place({ objectId: 'block', point: { x: 5.5, z: 5.5 } });
    const cells = gm.highlight({ x: 5.2, z: 5.4 }, 'token');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(MAX_HIGHLIGHT_CELLS);
    const invalid = cells.find((c) => c.cell.col === 5 && c.cell.row === 5);
    expect(invalid?.valid).toBe(false);
    expect(invalid?.reason).toBe('CELL_OCCUPIED');
    const valid = cells.find((c) => c.cell.col === 6 && c.cell.row === 6);
    expect(valid?.valid).toBe(true);
    expect(r.rendered.length).toBe(1);
  });

  it('clearHighlight resets the overlay', () => {
    const gm = makeGrid();
    const r = fakeRenderer();
    gm.attachHighlightRenderer(r);
    gm.highlight({ x: 0.5, z: 0.5 });
    gm.clearHighlight();
    expect(r.clears).toBe(1);
  });

  it('highlight without a renderer is a no-op computation', () => {
    const gm = makeGrid();
    expect(() => gm.highlight({ x: 0.5, z: 0.5 })).not.toThrow();
  });
});

describe('GridManager — performance', () => {
  // JIT warm-up: ilk ölçümdeki dalgalanmayı (cold transpile) önler
  function warmup(grid: GridManager, hex = false): void {
    for (let i = 0; i < 200; i++) {
      const p = hex ? { x: 3.137, z: -5.271 } : { x: 3, z: 7 };
      const cell = grid.worldToCell(p);
      if (cell) grid.cellToWorld(cell);
    }
  }

  it('1000 world<->cell roundtrips under 5 ms', () => {
    const gm = new GridManager({ shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 50, rows: 50 } });
    warmup(gm);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const p = { x: (i % 50) * 1.001, z: ((i * 7) % 50) * 0.999 };
      const cell = gm.worldToCell(p);
      if (!cell) continue;
      const c = gm.cellToWorld(cell);
      const back = gm.worldToCell(c);
      if (back?.col !== cell.col || back?.row !== cell.row) throw new Error(`roundtrip broke at ${i}`);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(5);
  });

  it('1000 hex roundtrips under 5 ms', () => {
    const gm = new GridManager({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, bounds: { radius: 12 } });
    warmup(gm, true);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const p = { x: ((i * 13) % 24) - 12 + 0.137, z: ((i * 29) % 24) - 12 + 0.271 };
      const cell = gm.worldToCell(p);
      if (!cell) continue;
      const c = gm.cellToWorld(cell);
      const back = gm.worldToCell(c);
      if (back?.col !== cell.col || back?.row !== cell.row) throw new Error(`hex roundtrip broke at ${i}`);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(5);
  });

  it('highlight window enumeration stays under 5 ms for 10x10', () => {
    const gm = makeGrid();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      gm.highlight({ x: 5.5 + (i % 3), z: 5.5 });
      gm.clearHighlight();
    }
    expect(performance.now() - t0).toBeLessThan(5);
  });
});

describe('parseTileEdges', () => {
  it('parses valid meta and rejects malformed shapes', () => {
    expect(parseTileEdges({ edges: { north: 'r', east: 'r', south: 'g', west: 'g' } })).toEqual({
      north: 'r',
      east: 'r',
      south: 'g',
      west: 'g',
    });
    expect(parseTileEdges({})).toBeUndefined();
    expect(parseTileEdges({ edges: { north: 'a' } })).toBeUndefined();
    expect(parseTileEdges(null)).toBeUndefined();
    expect(parseTileEdges('nope')).toBeUndefined();
  });
});

