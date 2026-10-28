/**
 * Manifest tests: the derived manifest must agree with the pack's own data
 * files, the disk and the A5 edge contract carried in defaultMeta.edges.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface Manifest {
  schemaVersion: number;
  packId: string;
  name: string;
  version: string;
  players: { min: number; max: number };
  tags?: string[];
  assets: Record<string, string>;
  components: { id: string; kind: string; assetRef: string; count: number; defaultMeta?: Record<string, unknown> }[];
  board?: { grid?: { cols: number; rows: number }; cellSize?: { width: number; depth: number }; snapPoints: { id: string; position: number[] }[] };
  decks?: { id: string; faces: string[]; backAssetRef?: string }[];
  localization: Record<string, Record<string, string>>;
}

const manifest = read<Manifest>('manifest.json');
const tiles = read<{ types: { id: string; count: number; edges: Record<string, string>; centre: string }[] }>(
  'tiles/tiles.json',
);
const board = read<{ grid: { cols: number; rows: number }; startCell: { col: number; row: number } }>('board/board.json');
const workers = read<{ workersPerPlayer: number; colors: { id: string; color: string }[] }>('tokens/workers.json');
const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');

const ALLOWED_EXT = ['.glb', '.gltf', '.png', '.jpg', '.webp', '.json', '.mp3', '.ogg'];
const OBJECT_KINDS = ['die', 'pawn', 'token', 'tile', 'board', 'card', 'deck', 'custom'];

describe('manifest', () => {
  test('identity fields are well formed', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.packId).toBe('tile-kingdoms');
    expect(manifest.name).toBe('Tile Kingdoms');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.players).toEqual({ min: 2, max: 5 });
    expect(new Set(manifest.tags).size).toBe(manifest.tags!.length);
  });

  test('every declared asset exists on disk with an allowed extension', () => {
    const paths = Object.values(manifest.assets);
    expect(new Set(paths).size).toBe(paths.length);
    for (const [key, path] of Object.entries(manifest.assets)) {
      expect(ALLOWED_EXT.some((ext) => path.endsWith(ext)), key).toBe(true);
      expect(existsSync(join(PACK, path)), path).toBe(true);
      expect(statSync(join(PACK, path)).size, path).toBeGreaterThan(0);
    }
  });

  test('24 tile components carry the full 72-tile bag', () => {
    const tileComponents = manifest.components.filter((c) => c.kind === 'tile');
    expect(tileComponents.length).toBe(24);
    expect(tileComponents.reduce((sum, c) => sum + c.count, 0)).toBe(72);
    const byId = new Map(tiles.types.map((t) => [t.id, t]));
    for (const c of tileComponents) {
      const source = byId.get(c.id);
      expect(source, c.id).toBeDefined();
      expect(c.count).toBe(source!.count);
      expect(c.assetRef).toBe(`tile-${c.id}`);
    }
  });

  test('tile defaultMeta.edges match tiles.json in the A5 shape', () => {
    for (const c of manifest.components.filter((k) => k.kind === 'tile')) {
      const edges = c.defaultMeta?.edges as Record<string, string> | undefined;
      expect(edges, c.id).toBeDefined();
      expect(Object.keys(edges!).sort()).toEqual(['east', 'north', 'south', 'west']);
      const source = tiles.types.find((t) => t.id === c.id)!;
      expect(edges).toEqual(source.edges);
      expect(c.defaultMeta?.centre).toBe(source.centre);
    }
    const meta = manifest.components.find((c) => c.id === 'start-capital')!.defaultMeta!;
    expect(meta.start).toBe(true);
  });

  test('component assetRefs are declared and kinds are known', () => {
    const names = new Set(Object.keys(manifest.assets));
    for (const c of manifest.components) {
      expect(OBJECT_KINDS, c.id).toContain(c.kind);
      expect(names.has(c.assetRef), `${c.id} -> ${c.assetRef}`).toBe(true);
    }
    const ids = manifest.components.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('board mirrors the square snap grid and the start cell', () => {
    expect(manifest.board?.grid).toEqual(board.grid);
    expect(manifest.board?.cellSize).toEqual({ width: 1, depth: 1 });
    const start = manifest.board!.snapPoints.find((p) => p.id === 'start-cell');
    expect(start).toBeDefined();
    expect(start!.position).toEqual([board.startCell.col + 0.5, 0, board.startCell.row + 0.5]);
  });

  test('the tile bag deck exposes all 24 faces and a back', () => {
    const deck = manifest.decks?.find((d) => d.id === 'tile-bag');
    expect(deck).toBeDefined();
    expect(deck!.faces).toEqual(tiles.types.map((t) => `tile-${t.id}`));
    expect(manifest.assets['tile-back']).toBe('assets/tile-back.png');
    const names = new Set(Object.keys(manifest.assets));
    for (const face of deck!.faces) expect(names.has(face)).toBe(true);
  });

  test('five worker colours × seven workers, four role badges', () => {
    for (const color of workers.colors) {
      const pawn = manifest.components.find((c) => c.id === `worker-${color.id}`);
      expect(pawn, color.id).toBeDefined();
      expect(pawn!.kind).toBe('pawn');
      expect(pawn!.count).toBe(workers.workersPerPlayer);
      expect(pawn!.defaultMeta?.color).toBe(color.color);
    }
    expect(manifest.components.filter((c) => c.defaultMeta?.role && c.kind === 'token').length).toBe(4);
  });

  test('manifest.localization mirrors the i18n files exactly', () => {
    expect(manifest.localization.tr).toEqual(tr);
    expect(manifest.localization.en).toEqual(en);
  });
});
