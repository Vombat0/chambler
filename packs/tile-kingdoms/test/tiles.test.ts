/**
 * Tile content tests: the bag must be internally consistent — 24 types, 72
 * tiles, A5-shaped edge records, even edge-value distribution (every edge can
 * in principle find a partner) and exactly one marked start tile.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface TileType {
  id: string;
  count: number;
  centre: string;
  edges: Record<string, string>;
  special?: string;
  pennants?: number;
  fortress?: boolean;
}

const tiles = read<{ edgeTypes: string[]; centres: string[]; totalTypes: number; totalTiles: number; types: TileType[] }>(
  'tiles/tiles.json',
);
const board = read<{
  gridType: string;
  grid: { cols: number; rows: number };
  startCell: { col: number; row: number };
  startTile: string;
  edgeContract: { keys: string[]; matchRule: string; rotations: number[] };
}>('board/board.json');
const rules = read<{ bag: { tiles: number; types: number }; scoring: { city: { fortressTileId: string } } }>(
  'rules/rules.json',
);
const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EDGE_KEYS = ['north', 'east', 'south', 'west'];

describe('tile bag', () => {
  test('24 unique tile types with kebab-case ids', () => {
    expect(tiles.types.length).toBe(24);
    expect(tiles.totalTypes).toBe(24);
    const ids = tiles.types.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB_RE);
  });

  test('the bag holds exactly 72 tiles', () => {
    const total = tiles.types.reduce((sum, t) => sum + t.count, 0);
    expect(total).toBe(72);
    expect(tiles.totalTiles).toBe(72);
    expect(rules.bag.tiles).toBe(72);
    expect(rules.bag.types).toBe(tiles.types.length);
    for (const t of tiles.types) {
      expect(Number.isInteger(t.count)).toBe(true);
      expect(t.count).toBeGreaterThanOrEqual(1);
    }
  });

  test('every tile carries the A5 edge shape with known edge values', () => {
    for (const t of tiles.types) {
      expect(Object.keys(t.edges).sort()).toEqual([...EDGE_KEYS].sort());
      for (const key of EDGE_KEYS) {
        expect(tiles.edgeTypes, `${t.id}.${key}`).toContain(t.edges[key]);
      }
    }
    expect(tiles.edgeTypes.sort()).toEqual(['city', 'field', 'road', 'shrine']);
  });

  test('centres are known features', () => {
    for (const t of tiles.types) expect(tiles.centres, t.id).toContain(t.centre);
  });

  test('edge distribution is consistent across the 72 tiles', () => {
    const counts = new Map<string, number>();
    const typeSupport = new Map<string, Set<string>>();
    let totalEdges = 0;
    for (const t of tiles.types) {
      for (const key of EDGE_KEYS) {
        const v = t.edges[key]!;
        counts.set(v, (counts.get(v) ?? 0) + t.count);
        totalEdges += t.count;
        if (!typeSupport.has(v)) typeSupport.set(v, new Set());
        typeSupport.get(v)!.add(t.id);
      }
    }
    expect(totalEdges).toBe(72 * 4);
    for (const [value, n] of counts) {
      expect(n % 2, `edge value ${value} must appear an even number of times`).toBe(0);
      expect(typeSupport.get(value)!.size, value).toBeGreaterThanOrEqual(2);
    }
    for (const value of tiles.edgeTypes) expect(counts.has(value)).toBe(true);
  });

  test('exactly one marked start tile, matching the board', () => {
    const starts = tiles.types.filter((t) => t.special === 'start');
    expect(starts.length).toBe(1);
    const start = starts[0]!;
    expect(start.count).toBe(1);
    expect(start.id).toBe(board.startTile);
    expect(start.edges).toEqual({ north: 'city', east: 'field', south: 'city', west: 'field' });
  });

  test('every tile type is localised and each side of the board agrees with it', () => {
    for (const t of tiles.types) {
      for (const dict of [tr, en]) {
        expect(dict[`tile.${t.id}.name`] ?? null, t.id).not.toBeNull();
        expect(dict[`tile.${t.id}.desc`] ?? null, t.id).not.toBeNull();
      }
    }
    expect(board.gridType).toBe('square');
    expect(board.startCell.col).toBeLessThan(board.grid.cols);
    expect(board.startCell.row).toBeLessThan(board.grid.rows);
    expect([...board.edgeContract.keys].sort()).toEqual([...EDGE_KEYS].sort());
    expect(board.edgeContract.matchRule).toBe('facing-edge-values-equal');
    expect(board.edgeContract.rotations).toEqual([0, 90, 180, 270]);
  });

  test('pennants and fortresses only decorate city walls', () => {
    for (const t of tiles.types) {
      if (t.pennants !== undefined) {
        expect(Object.values(t.edges), t.id).toContain('city');
        expect(t.centre, t.id).toBe('city');
        expect(t.pennants).toBeGreaterThanOrEqual(1);
      }
      if (t.fortress === true) expect(t.id).toBe(rules.scoring.city.fortressTileId);
    }
    const fortress = tiles.types.find((t) => t.id === rules.scoring.city.fortressTileId);
    expect(fortress).toBeDefined();
    expect(fortress!.fortress).toBe(true);
    expect(fortress!.pennants).toBe(2);
  });
});
