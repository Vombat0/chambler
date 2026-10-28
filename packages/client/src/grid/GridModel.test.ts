import { describe, expect, it } from 'vitest';
import { GridModel, type CellCoord } from './GridModel.js';

const SQRT3 = Math.sqrt(3);

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

describe('GridModel — square', () => {
  const grid = new GridModel({ shape: 'square', originX: 0, originZ: 0, cellSize: 1 });

  it('cellToWorld returns the cell center', () => {
    const c = grid.cellToWorld({ col: 3, row: 2 });
    expect(near(c.x, 3.5)).toBe(true);
    expect(near(c.z, 2.5)).toBe(true);
  });

  it('origin offset shifts cellToWorld', () => {
    const g = new GridModel({ shape: 'square', originX: -2, originZ: 5, cellSize: 2 });
    const c = g.cellToWorld({ col: 0, row: 0 });
    expect(near(c.x, -1)).toBe(true);
    expect(near(c.z, 6)).toBe(true);
  });

  it('worldToCell of a cell center returns the cell', () => {
    expect(grid.worldToCell({ x: 3.5, z: 2.5 })).toEqual({ col: 3, row: 2 });
  });

  it('worldToCell <-> cellToWorld roundtrips', () => {
    for (let row = -5; row < 5; row++) {
      for (let col = -5; col < 5; col++) {
        const cell: CellCoord = { col, row };
        const back = grid.worldToCell(grid.cellToWorld(cell));
        expect(back).toEqual(cell);
      }
    }
  });

  it('boundary points map deterministically to the +axis side', () => {
    // x=3 is the right edge of cell 2 / left edge of cell 3
    expect(grid.worldToCell({ x: 3, z: 0 })?.col).toBe(3);
    expect(grid.worldToCell({ x: -1, z: 0 })?.col).toBe(-1);
  });

  it('fractional world positions resolve into the containing cell', () => {
    expect(grid.worldToCell({ x: 3.49, z: 2.51 })).toEqual({ col: 3, row: 2 });
    expect(grid.worldToCell({ x: 3.51, z: 1.99 })).toEqual({ col: 3, row: 1 });
  });

  it('out-of-bounds cells return null', () => {
    const g = new GridModel({ shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 5, rows: 5 } });
    expect(g.worldToCell({ x: 5.5, z: 0 })).toBeNull();
    expect(g.worldToCell({ x: -0.5, z: 0 })).toBeNull();
    expect(g.worldToCell({ x: 0.5, z: 4.5 })).toEqual({ col: 0, row: 4 });
    expect(g.worldToCell({ x: 0.5, z: 5.5 })).toBeNull();
  });

  it('every cell maps to a unique world center', () => {
    const g = new GridModel({ shape: 'square', originX: 10, originZ: -7, cellSize: 0.4, bounds: { cols: 20, rows: 20 } });
    const seen = new Set<string>();
    let n = 0;
    g.forEachCell((cell) => {
      const w = g.cellToWorld(cell);
      seen.add(`${w.x.toFixed(6)},${w.z.toFixed(6)}`);
      n++;
    });
    expect(n).toBe(400);
    expect(seen.size).toBe(400);
  });

  it('rejects invalid cellSize', () => {
    expect(() => new GridModel({ shape: 'square', originX: 0, originZ: 0, cellSize: 0 })).toThrow();
  });
});

describe('GridModel — hex', () => {
  it('pointy-top cellToWorld has exact neighbor pitch sqrt(3)', () => {
    const g = new GridModel({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, hexOrientation: 'pointy', bounds: { radius: 4 } });
    const a = g.cellToWorld({ col: 1, row: 0 });
    const b = g.cellToWorld({ col: 0, row: 0 });
    expect(near(a.x, SQRT3)).toBe(true);
    expect(near(a.z, 0)).toBe(true);
    expect(g.worldToCell({ x: SQRT3, z: 0 })).toEqual({ col: 1, row: 0 });
    expect(near(b.x, 0, 1e-9)).toBe(true);
  });

  it('pointy-top (0,1) center is half pitch right, 1.5 size down', () => {
    const g = new GridModel({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, hexOrientation: 'pointy', bounds: { radius: 4 } });
    const c = g.cellToWorld({ col: 0, row: 1 });
    expect(near(c.x, SQRT3 / 2)).toBe(true);
    expect(near(c.z, 1.5)).toBe(true);
  });

  it('pointy-top roundtrips across the whole bounded hexagon', () => {
    const g = new GridModel({ shape: 'hex', originX: 3.3, originZ: -1.7, cellSize: 0.7, hexOrientation: 'pointy', bounds: { radius: 3 } });
    g.forEachCell((cell) => {
      const back = g.worldToCell(g.cellToWorld(cell));
      expect(back).toEqual(cell);
    });
  });

  it('flat-top roundtrips across the whole bounded hexagon', () => {
    const g = new GridModel({ shape: 'hex', originX: -8, originZ: 8, cellSize: 1.3, hexOrientation: 'flat', bounds: { radius: 3 } });
    const c = g.cellToWorld({ col: 1, row: 0 });
    expect(near(c.x, -8 + 1.5 * 1.3)).toBe(true); // originX + 1.5 * cellSize
    expect(near(c.z, 8 + (SQRT3 / 2) * 1.3)).toBe(true); // originZ + sqrt(3) * cellSize * (r + q/2)
    g.forEachCell((cell) => {
      const back = g.worldToCell(g.cellToWorld(cell));
      expect(back).toEqual(cell);
    });
  });

  it('hex bounds use cube distance radius', () => {
    const g = new GridModel({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, hexOrientation: 'pointy', bounds: { radius: 2 } });
    expect(g.inBounds({ col: 2, row: 0 })).toBe(true);
    expect(g.inBounds({ col: 3, row: 0 })).toBe(false);
    expect(g.worldToCell({ x: 100, z: 100 })).toBeNull();
  });

  it('hex cellCount matches the hexagonal number formula 3r^2+3r+1', () => {
    for (const radius of [0, 1, 2, 3, 4]) {
      const g = new GridModel({ shape: 'hex', originX: 0, originZ: 0, cellSize: 1, bounds: { radius } });
      expect(g.cellCount()).toBe(3 * radius * radius + 3 * radius + 1);
    }
  });
});

describe('GridModel — cellsNear / highlight window', () => {
  const g = new GridModel({ shape: 'square', originX: 0, originZ: 0, cellSize: 1, bounds: { cols: 30, rows: 30 } });

  it('returns nearest-first cells within the radius', () => {
    const cells = g.cellsNear({ x: 0.5, z: 0.5 }, 1.2, 200);
    expect(cells[0]).toEqual({ col: 0, row: 0 });
    // distance filter: far corner cells are excluded
    for (const cell of cells) {
      const c = g.cellToWorld(cell);
      expect(Math.hypot(0.5 - c.x, 0.5 - c.z)).toBeLessThanOrEqual(1.2000001);
    }
  });

  it('caps the result at maxCount', () => {
    const cells = g.cellsNear({ x: 15.5, z: 15.5 }, 5, 200);
    expect(cells.length).toBeLessThanOrEqual(200);
    expect(cells.length).toBeGreaterThan(50);
    const eight = g.cellsNear({ x: 15.5, z: 15.5 }, 5, 8);
    expect(eight.length).toBe(8);
  });
});
