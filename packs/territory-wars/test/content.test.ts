/**
 * Manifest and content tests, including the trademark guard that keeps the pack
 * mechanically similar to the classic conquest genre but legally original.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gamePackManifestSchema, validatePack } from '@chambler/modkit';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface Manifest {
  packId: string;
  assets: Record<string, string>;
  components: { id: string; kind: string; assetRef: string }[];
  decks: { id: string; faces: string[]; backAssetRef: string }[];
  helpers: { type: string }[];
  board: { snapPoints: { id: string; position: [number, number, number] }[] };
  localization: Record<string, Record<string, string>>;
}

const manifest = read<Manifest>('manifest.json');
const board = read<{ regions: { id: string }[] }>('board/board.json');
const territory = read<{ cards: { id: string; value?: number; wild?: boolean }[] }>(
  'cards/territory.json',
);
const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');

describe('manifest', () => {
  test('passes the strict modkit schema', () => {
    const parsed = gamePackManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      throw new Error(`schema errors: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.success).toBe(true);
  });

  test('passes filesystem validation (validatePack)', async () => {
    const result = await validatePack(PACK);
    if (!result.ok) {
      throw new Error(`pack invalid: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.ok).toBe(true);
    expect(result.manifest.packId).toBe('territory-wars');
  });

  test('asset paths are relative, unique and limited to png/json', () => {
    const paths = Object.values(manifest.assets);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path).not.toMatch(/^(\/|[A-Za-z]:|~|.*\.\.)/);
      expect(/\.(png|json)$/.test(path)).toBe(true);
    }
  });

  test('has one snap point per region, scaled inside the 16x9 chart', () => {
    const points = manifest.board.snapPoints;
    expect(points).toHaveLength(board.regions.length);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
    for (const point of points) {
      const [x, y0, z] = point.position;
      expect(x).toBeGreaterThan(0);
      expect(z).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(16);
      expect(z).toBeLessThanOrEqual(9);
      expect(y0).toBe(0);
    }
  });

  test('decks cover 30 territory cards and 3 legion writs with declared backs', () => {
    expect(manifest.decks).toHaveLength(2);
    const known = new Set(Object.keys(manifest.assets));
    const byId = new Map(manifest.decks.map((d) => [d.id, d]));
    expect(byId.get('territory')!.faces).toHaveLength(30);
    expect(byId.get('legions')!.faces).toHaveLength(3);
    for (const deck of manifest.decks) {
      expect(known.has(deck.backAssetRef)).toBe(true);
      for (const face of deck.faces) expect(known.has(face)).toBe(true);
    }
  });

  test('components reference declared assets and cover board, dice, pawns, tokens, cards', () => {
    const known = new Set(Object.keys(manifest.assets));
    for (const component of manifest.components) expect(known.has(component.assetRef)).toBe(true);
    const kinds = new Set(manifest.components.map((c) => c.kind));
    for (const kind of ['board', 'die', 'pawn', 'token', 'card']) expect(kinds.has(kind)).toBe(true);
    expect(manifest.components.filter((c) => c.kind === 'pawn')).toHaveLength(6);
  });

  test('territory cards are all worth 1 and exactly two carry the wild flag', () => {
    for (const card of territory.cards) expect(card.value).toBe(1);
    expect(territory.cards.filter((c) => c.wild === true)).toHaveLength(2);
  });

  test('declares dice, turn and score helpers', () => {
    expect(manifest.helpers.map((h) => h.type).sort()).toEqual(['dice', 'score', 'turn']);
  });
});

describe('originality', () => {
  const haystack = JSON.stringify({
    tr,
    en,
    manifest: { ...manifest, localization: undefined },
    board: readFileSync(join(PACK, 'board/board.json'), 'utf8'),
  }).toLowerCase();

  test('no trademarked game or publisher names appear anywhere in pack text', () => {
    const banned = [
      'risk',
      'hasbro',
      'wizards of the coast',
      'wotc',
      'parker brothers',
      'axis and allies',
      'pandemic',
      'diplomacy board game',
    ];
    for (const word of banned) {
      const re = new RegExp(`\\b${word}\\b`);
      expect(re.test(haystack), `banned word present: ${word}`).toBe(false);
    }
  });

  test('no classic world-map region names are borrowed', () => {
    const classic = [
      'kamchatka',
      'kamtchatka',
      'ural',
      'siberia',
      'irkutsk',
      'yakutsk',
      'yenisei',
      'karelia',
      'archangel',
      'novgorod',
      'smolensk',
      'madagascar',
      'congo',
      'quebec',
      'northwest territory',
    ];
    for (const name of classic) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(re.test(haystack), `borrowed region name: ${name}`).toBe(false);
    }
  });

  test('continent names are not the real-world continents of the classic map', () => {
    const classicContinents = [
      'north america',
      'south america',
      'europe',
      'africa',
      'asia',
      'australia',
      'middle east',
    ];
    const names = Object.entries(en)
      .filter(([key]) => key.startsWith('continent.'))
      .map(([, value]) => value.toLowerCase());
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) expect(classicContinents).not.toContain(name);
  });

  test('the manifest description claims mechanics similarity only, never a brand', () => {
    const raw = read<{ description: string }>('manifest.json');
    expect(raw.description.toLowerCase()).toContain('original');
  });
});
