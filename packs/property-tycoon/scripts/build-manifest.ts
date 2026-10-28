#!/usr/bin/env tsx
/**
 * Builds `manifest.json` from the pack's own data:
 *  - i18n/tr.json + i18n/en.json  -> manifest.localization
 *  - board/*.json                 -> board grid + 40 snap points
 *  - assets/*.png, *.json         -> manifest.assets (every generated file listed)
 *  - cards/*.json                 -> decks (faces + back)
 *
 * Keeping the manifest derived is what guarantees the "manifest assets match the
 * files on disk" invariant; run this after `generate-art.ts`.
 *
 * Run: ../../packages/modkit/node_modules/.bin/tsx scripts/build-manifest.ts
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..');

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface Cell {
  index: number;
  type: string;
  side: 'bottom' | 'left' | 'top' | 'right';
  slot: number;
  groupId?: string;
}
interface BoardFile {
  grid: { cols: number; rows: number };
  cells: Cell[];
}
interface DeckFile {
  deckId: string;
  cards: { id: string }[];
}
interface TokenFile {
  tokens: { id: string; color: string }[];
}

const board = readJson<BoardFile>('board/board.json');
const groups = readJson<{ groups: { id: string; color: string; members: number[] }[] }>(
  'board/groups.json',
);
const rules = readJson<{ currency: { denominations: number[] } }>('rules/rules.json');
const tokens = readJson<TokenFile>('tokens/tokens.json');
const chance = readJson<DeckFile>('cards/chance.json');
const community = readJson<DeckFile>('cards/community.json');
const tr = readJson<Record<string, string>>('i18n/tr.json');
const en = readJson<Record<string, string>>('i18n/en.json');

/* --------------------------------------------------------------- asset table */
const assets: Record<string, string> = {};

/** Content JSON files, logical name -> path. */
const contentAssets: Record<string, string> = {
  'board-layout': 'board/board.json',
  'board-groups': 'board/groups.json',
  rules: 'rules/rules.json',
  tokens: 'tokens/tokens.json',
  tiles: 'tiles/tiles.json',
  'deck-chance': 'cards/chance.json',
  'deck-community': 'cards/community.json',
  'i18n-tr': 'i18n/tr.json',
  'i18n-en': 'i18n/en.json',
  'art-index': 'assets/art-index.json',
};

const listFiles = (rel: string, ext: string): string[] => {
  const abs = join(PACK, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => `${rel}/${f}`);
};

for (const [key, path] of Object.entries(contentAssets)) assets[key] = path;
for (const path of listFiles('cards/faces', '.json')) {
  const id = path.slice('cards/faces/'.length, -'.json'.length);
  assets[`card-${id}`] = path;
}
for (const path of listFiles('assets', '.png')) {
  const stem = path.slice('assets/'.length, -'.png'.length);
  const key = stem === 'board' ? 'board-plate' : stem;
  assets[key] = path;
}

/* --------------------------------------------------------------- components */
const components: Record<string, unknown>[] = [
  { id: 'board', kind: 'board', assetRef: 'board-plate', count: 1 },
  { id: 'die-d6', kind: 'die', assetRef: 'die-d6', count: 2, defaultMeta: { sides: 6 } },
];

for (const token of tokens.tokens) {
  components.push({
    id: token.id,
    kind: 'pawn',
    assetRef: token.id,
    count: 1,
    defaultMeta: { color: token.color },
  });
}

const tileTypes = [...new Set(board.cells.map((c) => c.type))].sort();
for (const type of tileTypes) {
  const count = board.cells.filter((c) => c.type === type).length;
  components.push({
    id: `tile-${type}`,
    kind: 'tile',
    assetRef: `tile-${type}`,
    count,
    defaultMeta: { cellType: type },
  });
}

for (const group of groups.groups) {
  components.push({
    id: `deck-group-${group.id}`,
    kind: 'card',
    assetRef: `property-card-${group.id}`,
    count: group.members.length,
    defaultMeta: { groupId: group.id, color: group.color },
  });
}

/* --------------------------------------------------------------- snap points */
const { cols, rows } = board.grid;
const snapPoints = board.cells.map((cell) => {
  // grid runs clockwise from the bottom-right corner: index 0 sits at (cols-1, rows-1)
  const x =
    cell.side === 'bottom'
      ? cols - 1 - cell.slot
      : cell.side === 'top'
        ? cell.slot
        : cell.side === 'left'
          ? 0
          : cols - 1;
  const z =
    cell.side === 'left'
      ? rows - 1 - cell.slot
      : cell.side === 'right'
        ? cell.slot
        : cell.side === 'top'
          ? 0
          : rows - 1;
  // snap points carry the cell index so the engine maps a dice total to a slot
  // without guessing, and so a cell can be found by its own id.
  return {
    id: `cell-${String(cell.index).padStart(2, '0')}`,
    position: [x, 0, z],
    rotation: [0, 0, 0],
  };
});

/* -------------------------------------------------------------------- manifest */
const manifest = {
  schemaVersion: 1,
  packId: 'property-tycoon',
  name: 'Mülk Tycoon',
  description:
    'A 40-cell economic board game: buy districts, build houses and hotels, collect rent and outlast your rivals. Original board, original place names, original card texts and code-generated artwork; only the well-known roll-and-move mechanics are shared with the genre.',
  version: '0.1.0',
  author: 'Chambler Pack Team',
  license: 'MIT',
  minEngineVersion: '0.1.0',
  players: { min: 2, max: 6 },
  tags: ['board-game', 'property', 'economy', 'trade', 'classic', '2-6-players'],
  assets,
  components,
  board: {
    grid: { cols, rows },
    cellSize: { width: 1, depth: 1 },
    snapPoints,
  },
  decks: [
    {
      id: 'chance',
      faces: chance.cards.map((c) => `card-${c.id}`),
      backAssetRef: 'card-back-chance',
      shuffle: 'auto' as const,
    },
    {
      id: 'community',
      faces: community.cards.map((c) => `card-${c.id}`),
      backAssetRef: 'card-back-community',
      shuffle: 'auto' as const,
    },
  ],
  helpers: [
    { type: 'dice' as const, config: { notation: '2d6', sides: 6 } },
    {
      type: 'money' as const,
      config: { currency: 'CHB', unitScale: 1, denominations: rules.currency.denominations },
    },
    { type: 'score' as const, config: { min: 0, max: 1000000 } },
    { type: 'turn' as const, config: { maxPlayers: 6, direction: 'clockwise' } },
  ],
  localization: { tr, en },
};

writeFileSync(join(PACK, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const totalBytes = Object.values(assets).reduce(
  (sum, path) => sum + statSync(join(PACK, path)).size,
  0,
);
console.log(
  `manifest.json written: ${Object.keys(assets).length} assets, ${components.length} components, ` +
    `${manifest.decks.length} decks, ${snapPoints.length} snap points, ${Object.keys(tr).length}/${Object.keys(en).length} i18n keys, ` +
    `${(totalBytes / 1024).toFixed(1)} KiB referenced`,
);
