#!/usr/bin/env tsx
/**
 * Builds `manifest.json` for the territory-wars pack from its own data:
 *  - board/board.json + board/continents.json -> 28 region snap points
 *  - cards/*.json                              -> decks (faces + backs)
 *  - cards/faces/*.json, assets/*.png          -> manifest.assets
 *  - i18n/tr.json + i18n/en.json               -> manifest.localization
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

interface Region {
  id: string;
  continent: string;
  nameKey: string;
  anchor: [number, number];
  neighbors: string[];
  fortress?: boolean;
}
interface DeckFile {
  deckId: string;
  cards: { id: string }[];
}
interface TokenFile {
  tokens: { id: string; color: string; nameKey: string }[];
  armies: { id: string; count: number; nameKey: string };
}

const board = readJson<{ regions: Region[] }>('board/board.json');
const continents = readJson<{ continents: { id: string }[] }>('board/continents.json');
const rules = readJson<{ conflict: { attacker: { maxDice: number } } }>('rules/rules.json');
const tokens = readJson<TokenFile>('tokens/tokens.json');
const territory = readJson<DeckFile>('cards/territory.json');
const legions = readJson<DeckFile>('cards/legions.json');
const tr = readJson<Record<string, string>>('i18n/tr.json');
const en = readJson<Record<string, string>>('i18n/en.json');

/* --------------------------------------------------------------- asset table */
const assets: Record<string, string> = {};

const contentAssets: Record<string, string> = {
  'board-layout': 'board/board.json',
  'board-continents': 'board/continents.json',
  rules: 'rules/rules.json',
  tokens: 'tokens/tokens.json',
  'deck-territory': 'cards/territory.json',
  'deck-legions': 'cards/legions.json',
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
  const key = stem === 'map' ? 'map-plate' : stem;
  assets[key] = path;
}

/* --------------------------------------------------------------- components */
const components: Record<string, unknown>[] = [
  { id: 'war-map', kind: 'board', assetRef: 'map-plate', count: 1 },
  { id: 'die-d6', kind: 'die', assetRef: 'dice-6', count: 2, defaultMeta: { sides: 6 } },
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

components.push({
  id: tokens.armies.id,
  kind: 'token',
  assetRef: tokens.armies.id,
  count: tokens.armies.count,
  defaultMeta: { role: 'army' },
});

for (const legionId of ['spearwatch', 'stormwing', 'ironbull']) {
  components.push({
    id: `unit-${legionId}`,
    kind: 'token',
    assetRef: `unit-${legionId}`,
    count: 3,
    defaultMeta: { legionId },
  });
}

components.push(
  {
    id: 'territory-banner-stack',
    kind: 'card',
    assetRef: 'card-back-territory',
    count: territory.cards.length,
    defaultMeta: { deck: 'territory' },
  },
  {
    id: 'legion-writ-stack',
    kind: 'card',
    assetRef: 'card-back-legions',
    count: legions.cards.length,
    defaultMeta: { deck: 'legions' },
  },
);

/* --------------------------------------------------------------- snap points */
const snapPoints = board.regions.map((region) => ({
  // world units: the 1600x900 chart scales to 16x9 table metres
  id: `region-${region.id}`,
  position: [region.anchor[0] / 100, 0, region.anchor[1] / 100],
  rotation: [0, 0, 0],
}));

/* -------------------------------------------------------------------- manifest */
const manifest = {
  schemaVersion: 1,
  packId: 'territory-wars',
  name: 'Territory Wars',
  description:
    'A conquest strategy game on the invented world of Aetheris: 28 regions across 5 continents, reinforce, march along the adjacency roads and settle it with 3-vs-2 conflict dice. Original map, original region and continent names, original card texts and code-generated artwork; only the area-control mechanics are shared with the genre.',
  version: '0.1.0',
  author: 'Chambler Pack Team',
  license: 'MIT',
  minEngineVersion: '0.1.0',
  players: { min: 2, max: 6 },
  tags: ['board-game', 'strategy', 'area-control', 'conquest', 'dice', 'cards', '2-6-players'],
  assets,
  components,
  board: { snapPoints },
  decks: [
    {
      id: 'territory',
      faces: territory.cards.map((c) => `card-${c.id}`),
      backAssetRef: 'card-back-territory',
      shuffle: 'auto' as const,
    },
    {
      id: 'legions',
      faces: legions.cards.map((c) => `card-${c.id}`),
      backAssetRef: 'card-back-legions',
      shuffle: 'auto' as const,
    },
  ],
  helpers: [
    {
      type: 'dice' as const,
      config: { sides: 6, maxPerRoll: rules.conflict.attacker.maxDice, role: 'conflict' },
    },
    { type: 'turn' as const, config: { maxPlayers: 6, direction: 'clockwise' } },
    { type: 'score' as const, config: { min: 0, max: board.regions.length, label: 'regions' } },
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
    `${manifest.decks.length} decks, ${snapPoints.length} snap points, ` +
    `${continents.continents.length} continents, ${Object.keys(tr).length}/${Object.keys(en).length} i18n keys, ` +
    `${(totalBytes / 1024).toFixed(1)} KiB referenced`,
);
