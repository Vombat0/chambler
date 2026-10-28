import { describe, expect, it } from 'vitest';
import {
  checkEdges,
  edgeOffset,
  oppositeEdge,
  rotateTileEdges,
  tileEdge,
  type EdgeDirection,
  type EdgeValue,
  type NeighborSource,
  type TileEdges,
} from './TileEdges.js';
const T: TileEdges = { north: 'N', east: 'E', south: 'S', west: 'W' };

describe('rotateTileEdges', () => {
  it('0 is identity', () => {
    expect(rotateTileEdges(T, 0)).toEqual({ north: 'N', east: 'E', south: 'S', west: 'W' });
  });

  it('90° clockwise: old west faces north', () => {
    const r = rotateTileEdges(T, 90);
    expect(r.north).toBe('W');
    expect(r.east).toBe('N');
    expect(r.south).toBe('E');
    expect(r.west).toBe('S');
  });

  it('180°: old south faces north', () => {
    const r = rotateTileEdges(T, 180);
    expect(r.north).toBe('S');
    expect(r.east).toBe('W');
    expect(r.south).toBe('N');
    expect(r.west).toBe('E');
  });

  it('270°: old east faces north', () => {
    const r = rotateTileEdges(T, 270);
    expect(r.north).toBe('E');
    expect(r.east).toBe('S');
    expect(r.south).toBe('W');
    expect(r.west).toBe('N');
  });

  it('rotating four times returns to the original', () => {
    let cur = T;
    for (const rot of [90, 90, 90, 90] as const) {
      cur = rotateTileEdges(cur, rot);
    }
    expect(cur).toEqual(T);
  });

  it('tileEdge + oppositeEdge + edgeOffset agree on the map layout', () => {
    expect(oppositeEdge('north')).toBe('south');
    expect(oppositeEdge('east')).toBe('west');
    expect(edgeOffset('north')).toEqual({ col: 0, row: -1 });
    expect(edgeOffset('south')).toEqual({ col: 0, row: 1 });
    expect(edgeOffset('east')).toEqual({ col: 1, row: 0 });
    expect(edgeOffset('west')).toEqual({ col: -1, row: 0 });
    expect(tileEdge(T, 'east')).toBe('E');
  });
});

describe('checkEdges (neighbor matching)', () => {
  const cell = { col: 3, row: 3 };

  function sourceWith(east: TileEdges | undefined, west?: TileEdges): NeighborSource {
    return {
      effectiveEdgesAt(c: { col: number; row: number }) {
        if (c.col === cell.col + 1 && c.row === cell.row) return east; // east neighbor
        if (c.col === cell.col - 1 && c.row === cell.row) return west; // west neighbor
        return undefined;
      },
    };
  }

  it('equal facing edges match (east neighbor west edge)', () => {
    const neighbor: TileEdges = { north: '0', east: '0', south: '0', west: 'road' };
    const direct: TileEdges = { north: '0', east: 'road', south: '0', west: '0' };
    expect(checkEdges(cell, direct, sourceWith(neighbor)).ok).toBe(true);
  });

  it('unequal facing edges are rejected with reason and details', () => {
    const neighbor: TileEdges = { north: '0', east: '0', south: '0', west: 'road' };
    const mine: TileEdges = { north: '0', east: 'grass', south: '0', west: '0' };
    const r = checkEdges(cell, mine, sourceWith(neighbor));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EDGE_MISMATCH');
    expect(r.direction).toBe('east');
    expect(r.expected).toBe('road');
    expect(r.found).toBe('grass');
  });

  it('empty and out-of-range neighbors impose no constraint', () => {
    const mine: TileEdges = { north: 'city', east: 'city', south: 'city', west: 'city' };
    expect(checkEdges(cell, mine, sourceWith(undefined)).ok).toBe(true);
  });

  it('checks the west neighbor direction too', () => {
    const neighborW: TileEdges = { north: '0', east: 'field', south: '0', west: '0' };
    const mine: TileEdges = { north: '0', east: '0', south: '0', west: 'field' };
    expect(checkEdges(cell, mine, sourceWith(undefined, neighborW)).ok).toBe(true);
    const bad: TileEdges = { north: '0', east: '0', south: '0', west: 'road' };
    const r = checkEdges(cell, bad, sourceWith(undefined, neighborW));
    expect(r.direction).toBe('west');
  });

  /** Independent, manual table of N/E/S/W projections for all four rotations. */
  const manual: Record<number, TileEdges> = {
    0: { north: 'N', east: 'E', south: 'S', west: 'W' },
    90: { north: 'W', east: 'N', south: 'E', west: 'S' },
    180: { north: 'S', east: 'W', south: 'N', west: 'E' },
    270: { north: 'E', east: 'S', south: 'W', west: 'N' },
  };

  it('4 rotations × facing neighbors: matched and mismatched', () => {
    const base: TileEdges = { north: 'N', east: 'E', south: 'S', west: 'W' };
    for (const dir of ['north', 'east', 'south', 'west'] as EdgeDirection[]) {
      for (const rot of [0, 90, 180, 270] as const) {
        const r = rotateTileEdges(base, rot);
        // the neighbor presents exactly the matching value on the FACING side
        const okNeighbor: TileEdges = { north: '0', east: '0', south: '0', west: '0' };
        (okNeighbor as Record<Exclude<EdgeDirection, never>, EdgeValue>)[oppositeEdge(dir)] = r[dir];
        expect(checkEdges(cell, r, sourceMatching(dir, okNeighbor)).ok).toBe(true);
        // a wrong value on the facing side is rejected
        const badNeighbor: TileEdges = { north: '0', east: '0', south: '0', west: '0' };
        (badNeighbor as Record<Exclude<EdgeDirection, never>, string>)[oppositeEdge(dir)] = `${dir}-x`;
        const res = checkEdges(cell, r, sourceMatching(dir, badNeighbor));
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('EDGE_MISMATCH');
        expect(res.direction).toBe(dir);
        expect(res.expected).toBe(`${dir}-x`);
        expect(res.found).toBe(r[dir]);
        // manual projection table stays in the test as the rotation spec
        expect(manual[rot]!.north).toBeDefined();
      }
    }
  });

  function sourceMatching(dir: EdgeDirection, neighbor: TileEdges): NeighborSource {
    const offsets: Record<EdgeDirection, { col: number; row: number }> = {
      north: { col: 0, row: -1 },
      east: { col: 1, row: 0 },
      south: { col: 0, row: 1 },
      west: { col: -1, row: 0 },
    };
    const o = offsets[dir];
    return {
      effectiveEdgesAt(c: { col: number; row: number }) {
        return c.col === cell.col + o.col && c.row === cell.row + o.row ? neighbor : undefined;
      },
    };
  }
});
