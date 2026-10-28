/**
 * Rotation + attachment tests. They mirror the pure A5 contract from
 * `packages/client/src/grid/TileEdges.ts` (rotateTileEdges: rotated[i] =
 * seq[(i - shift + 4) % 4] over [N,E,S,W]; checkEdges: facing edges equal).
 * The mirror is kept local so the pack validates without importing the client.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

type Edges = { north: string; east: string; south: string; west: string };
type Dir = 'north' | 'east' | 'south' | 'west';
type TileType = { id: string; count: number; edges: Edges };

const types = read<{ types: TileType[] }>('tiles/tiles.json').types;
const start = types.find((t) => t.id === 'start-capital')!;

const DIRS: Dir[] = ['north', 'east', 'south', 'west'];
const OPPOSITE: Record<Dir, Dir> = { north: 'south', east: 'west', south: 'north', west: 'east' };

function rotate(edges: Edges, rotation: 0 | 90 | 180 | 270): Edges {
  const seq = [edges.north, edges.east, edges.south, edges.west];
  const shift = ((rotation / 90) % 4 + 4) % 4;
  const rotated = seq.map((_, i) => seq[(i - shift + 4) % 4]!);
  return { north: rotated[0]!, east: rotated[1]!, south: rotated[2]!, west: rotated[3]! };
}

function edge(edges: Edges, dir: Dir): string {
  return edges[dir];
}

/** A5 checkEdges against a single occupied neighbour cell; empty cells are free. */
function checkAgainst(
  mine: Edges,
  neighbourDir: Dir,
  neighbourEdges: Edges | undefined,
): { ok: boolean; dir?: Dir } {
  if (!neighbourEdges) return { ok: true };
  const d = neighbourDir;
  if (edge(mine, d) !== edge(neighbourEdges, OPPOSITE[d])) return { ok: false, dir: d };
  return { ok: true };
}

const ROTATIONS = [0, 90, 180, 270] as const;

/** Does any rotation of `t` legally attach on `dir` of the start tile? */
function attachesToStart(t: TileType, dir: Dir): boolean {
  return ROTATIONS.some((r) => checkAgainst(rotate(t.edges, r), OPPOSITE[dir], start.edges).ok);
}

describe('rotation contract (A5 TileEdges mirror)', () => {
  test('rotation 0 is the identity and 90° maps west→north, north→east', () => {
    for (const t of types) {
      expect(rotate(t.edges, 0)).toEqual(t.edges);
      const r = rotate(t.edges, 90);
      expect(r.north, t.id).toBe(t.edges.west);
      expect(r.east, t.id).toBe(t.edges.north);
      expect(r.south, t.id).toBe(t.edges.east);
      expect(r.west, t.id).toBe(t.edges.south);
    }
  });

  test('four quarter turns return every tile to its original edges', () => {
    for (const t of types) {
      let cur = t.edges;
      for (let i = 0; i < 4; i++) cur = rotate(cur, 90);
      expect(cur, t.id).toEqual(t.edges);
      expect(rotate(t.edges, 180), t.id).toEqual(rotate(rotate(t.edges, 90), 90));
      expect(rotate(t.edges, 270), t.id).toEqual(rotate(rotate(rotate(t.edges, 90), 90), 90));
    }
  });

  test('rotation permutes but never changes the edge multiset', () => {
    for (const t of types) {
      for (const r of ROTATIONS) {
        const rotated = rotate(t.edges, r);
        expect(Object.values(rotated).sort(), `${t.id}@${r}`).toEqual(Object.values(t.edges).sort());
      }
    }
  });
});

describe('attachment to the start tile', () => {
  test('at least two distinct tile types can legally attach on every side', () => {
    for (const dir of DIRS) {
      const ok = types.filter((t) => attachesToStart(t, dir));
      expect(ok.length, `side ${dir}`).toBeGreaterThanOrEqual(2);
    }
  });

  test('city sides only accept city edges and field sides only field edges', () => {
    for (const dir of DIRS) {
      const required = start.edges[dir];
      for (const t of types) {
        if (!attachesToStart(t, dir)) continue;
        const witness = ROTATIONS.find((r) => checkAgainst(rotate(t.edges, r), OPPOSITE[dir], start.edges).ok)!;
        expect(edge(rotate(t.edges, witness), OPPOSITE[dir]), `${t.id}@${dir}`).toBe(required);
      }
    }
  });

  test('an all-road tile is rejected on both city sides of the start tile', () => {
    const crossing = types.find((t) => t.id === 'road-crossing')!;
    expect(Object.values(crossing.edges).every((v) => v === 'road')).toBe(true);
    for (const dir of ['north', 'south'] as const) {
      for (const r of ROTATIONS) {
        const result = checkAgainst(rotate(crossing.edges, r), OPPOSITE[dir], start.edges);
        expect(result.ok, `road-crossing@${r} on ${dir}`).toBe(false);
        expect(result.dir).toBe(OPPOSITE[dir]);
      }
    }
  });

  test('a shrine-corner tile cannot fake a city edge; a road cannot fake a field', () => {
    const shrine = types.find((t) => t.id === 'shrine-corner')!;
    expect(shrine.edges.north).toBe('shrine');
    for (const r of ROTATIONS) {
      const rotated = Object.values(rotate(shrine.edges, r));
      expect(rotated).not.toContain('city');
    }
    const crossing = types.find((t) => t.id === 'road-crossing')!;
    for (const r of ROTATIONS) {
      const rotated = Object.values(rotate(crossing.edges, r));
      expect(rotated).not.toContain('field');
      expect(checkAgainst(rotate(crossing.edges, r), 'west', start.edges).ok).toBe(false);
    }
  });

  test('matching is symmetric: what attaches east of the start also hosts the start on its west', () => {
    for (const t of types) {
      for (const r of ROTATIONS) {
        const placed = rotate(t.edges, r);
        const forward = checkAgainst(placed, 'west', start.edges).ok;
        if (!forward) continue;
        const mirror = checkAgainst(start.edges, 'east', placed).ok;
        expect(mirror, `${t.id}@${r} must be symmetric`).toBe(true);
      }
    }
  });
});
