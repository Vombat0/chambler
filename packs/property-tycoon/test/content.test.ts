/**
 * Property-tycoon pack tests (own vitest project, not part of the root workspace).
 *
 *   pnpm --filter modkit build                 # validator dist (optional, tests use src)
 *   pnpm --dir packs/property-tycoon test:local
 *
 * `globals: true` is set in vitest.config.ts so the suite needs no bare imports
 * and therefore no node_modules of its own inside the pack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gamePackManifestSchema, validatePack } from '@chambler/modkit';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface Cell {
  id: string;
  index: number;
  slug: string;
  type: string;
  nameKey: string;
  side: 'bottom' | 'left' | 'top' | 'right';
  slot: number;
  groupId?: string;
  price?: number;
  rent?: number[];
  houseCost?: number;
  hotelCost?: number;
  mortgage?: number;
  taxAmount?: number;
  deckId?: string;
  rentMode?: string;
}
interface Group {
  id: string;
  nameKey: string;
  color: string;
  members: number[];
  size: number;
  houseCost: number;
  hotelCost: number;
}
interface Board {
  grid: { cols: number; rows: number };
  cornerIndices: number[];
  cellsPerSide: number;
  cells: Cell[];
}
interface Deck {
  deckId: string;
  cards: {
    id: string;
    titleKey: string;
    textKey: string;
    effect: { type: string; amount?: number };
  }[];
}
interface Manifest {
  assets: Record<string, string>;
  components: { id: string; kind: string; assetRef: string; count: number }[];
  decks: { id: string; faces: string[]; backAssetRef?: string }[];
  board: { grid: { cols: number; rows: number }; snapPoints: { id: string; position: number[] }[] };
  helpers: { type: string; config?: Record<string, unknown> }[];
  localization: Record<string, Record<string, string>>;
}

const board = read<Board>('board/board.json');
const groups = read<{ groups: Group[] }>('board/groups.json').groups;
const rules = read<{
  currency: { denominations: number[]; unitScale: number };
  start: { money: number; salary: number };
  jail: { fine: number; maxTurns: number };
  build: { maxHouses: number; hotelAfterHouses: number; evenBuildRule: boolean };
  auction: { enabled: boolean };
}>('rules/rules.json');
const manifest = read<Manifest>('manifest.json');
const chance = read<Deck>('cards/chance.json');
const community = read<Deck>('cards/community.json');
const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');

const TYPES = new Set([
  'start',
  'property',
  'transport',
  'energy',
  'tax',
  'chance',
  'community',
  'jail',
  'free-parking',
  'go-to-jail',
]);
const PRICED = new Set(['property', 'transport', 'energy']);
const isPosInt = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n > 0;

describe('board', () => {
  test('has 40 cells indexed 0..39 exactly once', () => {
    expect(board.cells).toHaveLength(40);
    const indices = board.cells.map((c) => c.index).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(new Set(board.cells.map((c) => c.id)).size).toBe(40);
    expect(new Set(board.cells.map((c) => c.slug)).size).toBe(40);
  });

  test('every cell has a known type and a name key', () => {
    for (const cell of board.cells) {
      expect(TYPES.has(cell.type)).toBe(true);
      expect(cell.nameKey).toBe(`cell.${cell.index}.name`);
    }
  });

  test('four sides of 11 slots each, corners shared', () => {
    const edgesOf = (cell: Cell) =>
      (cell as Cell & { edges: { side: string; slot: number }[] }).edges;
    for (const side of ['bottom', 'left', 'top', 'right']) {
      const slots = board.cells
        .flatMap((c) =>
          edgesOf(c)
            .filter((e) => e.side === side)
            .map((e) => e.slot),
        )
        .sort((a, b) => a - b);
      expect(slots).toEqual(Array.from({ length: board.cellsPerSide }, (_, i) => i));
    }
    // 44 edge positions over 40 cells: only the four corners are shared
    expect(board.cells.reduce((sum, c) => sum + edgesOf(c).length, 0)).toBe(44);
    expect(board.cells.filter((c) => edgesOf(c).length > 1).map((c) => c.index)).toEqual([
      0, 10, 20, 30,
    ]);
    expect(board.cells).toHaveLength(40);
  });

  test('corner cells carry the four corner types', () => {
    const corners = board.cornerIndices.map((i) => board.cells.find((c) => c.index === i)!);
    expect(corners.map((c) => c.type)).toEqual(['start', 'jail', 'free-parking', 'go-to-jail']);
    expect(corners.every((c) => c.index % 10 === 0)).toBe(true);
  });

  test('rent tables strictly increase for every priced cell', () => {
    const priced = board.cells.filter((c) => PRICED.has(c.type));
    expect(priced.length).toBe(28);
    for (const cell of priced) {
      const rent = cell.rent ?? [];
      expect(rent.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < rent.length; i++) {
        expect(rent[i]!).toBeGreaterThan(rent[i - 1]!);
      }
    }
  });

  test('prices, mortgages and build costs are positive integers', () => {
    for (const cell of board.cells.filter((c) => PRICED.has(c.type))) {
      expect(isPosInt(cell.price)).toBe(true);
      expect(cell.mortgage).toBe(Math.floor((cell.price ?? 0) / 2));
      if (cell.type === 'property') {
        expect(isPosInt(cell.houseCost)).toBe(true);
        expect(isPosInt(cell.hotelCost)).toBe(true);
        expect(cell.hotelCost!).toBeGreaterThanOrEqual(cell.houseCost!);
      }
    }
  });

  test('group sizes are 2 or 3 and members match their cells', () => {
    expect(groups).toHaveLength(8);
    for (const group of groups) {
      expect([2, 3]).toContain(group.size);
      expect(group.members).toHaveLength(group.size);
      for (const index of group.members) {
        const cell = board.cells.find((c) => c.index === index)!;
        expect(cell.groupId).toBe(group.id);
        expect(cell.type).toBe('property');
      }
    }
    const propertyCells = board.cells.filter((c) => c.type === 'property');
    expect(groups.reduce((sum, g) => sum + g.size, 0)).toBe(propertyCells.length);
    expect(propertyCells.every((c) => groups.some((g) => g.id === c.groupId))).toBe(true);
  });

  test('group colours are unique hex values', () => {
    const colours = groups.map((g) => g.color);
    expect(new Set(colours).size).toBe(groups.length);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test('harbours and energy plants form their own groups', () => {
    const transport = board.cells.filter((c) => c.type === 'transport');
    const energy = board.cells.filter((c) => c.type === 'energy');
    expect(transport).toHaveLength(4);
    expect(energy).toHaveLength(2);
    expect(new Set(transport.map((c) => c.groupId))).toEqual(new Set(['liman']));
    expect(new Set(energy.map((c) => c.groupId))).toEqual(new Set(['enerji']));
    expect(energy.every((c) => c.rentMode === 'dice-multiplier')).toBe(true);
  });

  test('tax, jail and go-to-jail cells carry their data', () => {
    for (const cell of board.cells.filter((c) => c.type === 'tax'))
      expect(isPosInt(cell.taxAmount)).toBe(true);
    const jail = board.cells.find((c) => c.type === 'jail')!;
    const goToJail = board.cells.find((c) => c.type === 'go-to-jail')!;
    expect(jail.index).toBe(10);
    expect(goToJail.index).toBe(30);
    expect(board.cells.find((c) => c.index === 10)!.type).toBe('jail');
  });
});

describe('rules', () => {
  test('start money, salary and jail fine are positive integers', () => {
    expect(isPosInt(rules.start.money)).toBe(true);
    expect(isPosInt(rules.start.salary)).toBe(true);
    expect(isPosInt(rules.jail.fine)).toBe(true);
    expect(rules.start.salary).toBeLessThan(rules.start.money);
    expect(rules.jail.maxTurns).toBeGreaterThan(0);
  });

  test('building rules include the even-build rule and hotel threshold', () => {
    expect(rules.build.evenBuildRule).toBe(true);
    expect(rules.build.maxHouses).toBe(4);
    expect(rules.build.hotelAfterHouses).toBe(4);
    expect(rules.auction.enabled).toBe(true);
  });

  test('denominations are positive, strictly increasing integers', () => {
    const d = rules.currency.denominations;
    expect(d.length).toBe(6);
    for (let i = 0; i < d.length; i++) {
      expect(isPosInt(d[i])).toBe(true);
      if (i > 0) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
    }
    expect(rules.currency.unitScale).toBe(1);
  });

  test('every money value in cards and board is an integer', () => {
    const amounts = [
      ...board.cells.flatMap((c) => [
        c.price,
        c.houseCost,
        c.hotelCost,
        c.mortgage,
        c.taxAmount,
        ...(c.rent ?? []),
      ]),
      ...chance.cards.map((c) => c.effect.amount),
      ...community.cards.map((c) => c.effect.amount),
    ].filter((v): v is number => v !== undefined);
    expect(amounts.length).toBeGreaterThan(50);
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
  });
});

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
    expect(result.manifest.packId).toBe('property-tycoon');
  });

  test('declares dice, money, score and turn helpers', () => {
    expect(manifest.helpers.map((h) => h.type).sort()).toEqual(['dice', 'money', 'score', 'turn']);
  });

  test('decks reference declared faces and backs', () => {
    expect(manifest.decks).toHaveLength(2);
    const known = new Set(Object.keys(manifest.assets));
    for (const deck of manifest.decks) {
      expect(deck.faces).toHaveLength(16);
      expect(known.has(deck.backAssetRef!)).toBe(true);
      for (const face of deck.faces) expect(known.has(face)).toBe(true);
    }
    expect(chance.cards).toHaveLength(16);
    expect(community.cards).toHaveLength(16);
  });

  test('components reference declared assets and cover board, pawns and tiles', () => {
    const known = new Set(Object.keys(manifest.assets));
    for (const component of manifest.components) expect(known.has(component.assetRef)).toBe(true);
    const kinds = new Set(manifest.components.map((c) => c.kind));
    for (const kind of ['board', 'die', 'pawn', 'tile', 'card']) expect(kinds.has(kind)).toBe(true);
    const pawns = manifest.components.filter((c) => c.kind === 'pawn');
    expect(pawns).toHaveLength(6);
  });

  test('has one snap point per cell, unique and inside the grid', () => {
    const points = manifest.board.snapPoints;
    expect(points).toHaveLength(40);
    expect(new Set(points.map((p) => p.id)).size).toBe(40);
    expect(new Set(points.map((p) => p.position.join(','))).size).toBe(40);
    for (const point of points) {
      const [x, , z] = point.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(manifest.board.grid.cols);
      expect(z).toBeLessThan(manifest.board.grid.rows);
    }
    expect(manifest.board.grid).toEqual(board.grid);
  });
});

describe('originality', () => {
  test('no trademarked board-game names appear in pack text', () => {
    const banned = [
      'monopoly',
      'hasbro',
      'parker brothers',
      'carcassonne',
      'settlers of catan',
      'risk board',
    ];
    const haystack = JSON.stringify({
      tr,
      en,
      manifest: { ...manifest, localization: undefined },
    }).toLowerCase();
    for (const word of banned) expect(haystack.includes(word)).toBe(false);
  });
});
