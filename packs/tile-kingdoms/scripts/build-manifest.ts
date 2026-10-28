#!/usr/bin/env tsx
/**
 * Builds `manifest.json` for the tile-kingdoms pack from its own data:
 *  - board/board.json        -> square snap grid + start-cell snap point
 *  - tiles/tiles.json        -> 24 tile components (defaultMeta.edges = A5 contract)
 *  - tokens/workers.json     -> worker pawns + role markers
 *  - assets/*.png            -> manifest.assets
 *  - i18n/tr.json + en.json  -> manifest.localization
 *
 * Keeping the manifest derived is what guarantees the "manifest assets match the
 * files on disk" invariant; run this after `generate-art.ts`.
 *
 * Run: ../../packages/modkit/node_modules/.bin/tsx scripts/build-manifest.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..');

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface TileType {
  id: string;
  count: number;
  centre: string;
  edges: { north: string; east: string; south: string; west: string };
  special?: 'start';
  pennants?: number;
  fortress?: boolean;
}
interface BoardFile {
  gridType: string;
  grid: { cols: number; rows: number };
  cellSize: { width: number; depth: number };
  startCell: { col: number; row: number };
  startTile: string;
}
interface WorkersFile {
  workersPerPlayer: number;
  roles: { id: string; feature: string; assetKey: string }[];
  colors: { id: string; color: string }[];
}

const board = readJson<BoardFile>('board/board.json');
const tiles = readJson<{ types: TileType[] }>('tiles/tiles.json');
const workers = readJson<WorkersFile>('tokens/workers.json');
const rules = readJson<{ scoring: { shrine: { value: number } } }>('rules/rules.json');
const tr = readJson<Record<string, string>>('i18n/tr.json');
const en = readJson<Record<string, string>>('i18n/en.json');

/* --------------------------------------------------------------- asset table */
const assets: Record<string, string> = {
  'board-layout': 'board/board.json',
  tiles: 'tiles/tiles.json',
  workers: 'tokens/workers.json',
  rules: 'rules/rules.json',
  'i18n-tr': 'i18n/tr.json',
  'i18n-en': 'i18n/en.json',
  'art-index': 'assets/art-index.json',
};

const listPng = (): string[] => {
  const abs = join(PACK, 'assets');
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => `assets/${f}`);
};

for (const path of listPng()) {
  const key = path.slice('assets/'.length, -'.png'.length);
  assets[key] = path;
}

/* --------------------------------------------------------------- components */
const components: Record<string, unknown>[] = [
  { id: 'kingdoms-playmat', kind: 'board', assetRef: 'playmat', count: 1 },
];

for (const t of tiles.types) {
  components.push({
    id: t.id,
    kind: 'tile',
    assetRef: `tile-${t.id}`,
    count: t.count,
    defaultMeta: {
      // A5 TileEdges contract: the client reads def.meta.edges when snapping tiles
      edges: t.edges,
      centre: t.centre,
      ...(t.special === 'start' ? { start: true } : {}),
      ...(t.pennants !== undefined ? { pennants: t.pennants } : {}),
      ...(t.fortress === true ? { fortress: true } : {}),
    },
  });
}

for (const color of workers.colors) {
  components.push({
    id: `worker-${color.id}`,
    kind: 'pawn',
    assetRef: `worker-${color.id}`,
    count: workers.workersPerPlayer,
    defaultMeta: { color: color.color, role: 'worker' },
  });
}

for (const role of workers.roles) {
  components.push({
    id: `role-${role.id}`,
    kind: 'token',
    assetRef: `role-${role.id}`,
    count: 5,
    defaultMeta: { role: role.id, feature: role.feature },
  });
}

/* ------------------------------------------------------------------ deck */
const deck = {
  id: 'tile-bag',
  faces: tiles.types.map((t) => `tile-${t.id}`),
  backAssetRef: 'tile-back',
  shuffle: 'auto' as const,
};

/* ----------------------------------------------------------------- manifest */
const totalTiles = tiles.types.reduce((sum, t) => sum + t.count, 0);
const manifest = {
  schemaVersion: 1,
  packId: 'tile-kingdoms',
  name: 'Tile Kingdoms',
  description:
    'A tile-laying worker-placement strategy game on the invented realm of Kare Kralliklar (Tile Kingdoms): draw tiles from a 72-tile bag, match their four edges (keep walls, trade roads, meadows, sacred marches) and place Watchmen, Guards, Monks and Farmers to score completed roads, cities and shrines. Original theme, original tile names, original texts and fully code-generated artwork; only the tile-placement mechanics are shared with the genre.',
  version: '0.1.0',
  author: 'Chambler Pack Team',
  license: 'MIT',
  minEngineVersion: '0.1.0',
  players: { min: 2, max: 5 },
  tags: ['board-game', 'tile-placement', 'worker-placement', 'strategy', 'area-control', '2-5-players'],
  assets,
  components,
  board: {
    grid: { cols: board.grid.cols, rows: board.grid.rows },
    cellSize: { width: board.cellSize.width, depth: board.cellSize.depth },
    snapPoints: [
      {
        id: 'start-cell',
        position: [board.startCell.col + board.cellSize.width / 2, 0, board.startCell.row + board.cellSize.depth / 2],
        rotation: [0, 0, 0],
      },
    ],
  },
  decks: [deck],
  helpers: [
    {
      type: 'turn',
      config: { maxPlayers: 5, direction: 'clockwise', phases: ['draw', 'place', 'worker', 'score'] },
    },
    {
      type: 'score',
      config: {
        min: 0,
        max: 999,
        label: 'victory points',
        shrineValue: rules.scoring.shrine.value,
        bagTiles: totalTiles,
      },
    },
  ],
  localization: { tr, en },
};

writeFileSync(join(PACK, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(
  `manifest.json: ${Object.keys(assets).length} assets, ${components.length} components, ${totalTiles} tiles across ${tiles.types.length} types, localization ${Object.keys(tr).length}/${Object.keys(en).length} keys`,
);
