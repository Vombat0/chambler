/**
 * Board graph tests: the adjacency graph of Aetheris must be a well-formed,
 * symmetric, connected map with coherent continents. Run from the pack dir:
 *   node ../../packages/modkit/node_modules/vitest/vitest.mjs run
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface Region {
  id: string;
  continent: string;
  nameKey: string;
  anchor: [number, number];
  neighbors: string[];
  fortress?: boolean;
}
interface Continent {
  id: string;
  nameKey: string;
  color: string;
  bonus: number;
  members: string[];
}

const board = read<{ canvas: { width: number; height: number }; regions: Region[] }>(
  'board/board.json',
);
const continents = read<{ continents: Continent[] }>('board/continents.json').continents;
const territory = read<{ cards: { regionId?: string; wild?: boolean }[] }>('cards/territory.json');

const R = new Map(board.regions.map((r) => [r.id, r]));
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const reachable = (start: string, filter?: (id: string) => boolean): Set<string> => {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const n of R.get(id)!.neighbors) {
      if (filter && !filter(n)) continue;
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
};

describe('regions', () => {
  test('has at least 24 regions with unique kebab-case ids', () => {
    expect(board.regions.length).toBeGreaterThanOrEqual(24);
    expect(R.size).toBe(board.regions.length);
    for (const region of board.regions) expect(region.id).toMatch(ID_RE);
  });

  test('every neighbor link points at a known region, never at itself', () => {
    for (const region of board.regions) {
      for (const n of region.neighbors) {
        expect(R.has(n), `${region.id} -> ${n}`).toBe(true);
        expect(n).not.toBe(region.id);
      }
      expect(new Set(region.neighbors).size).toBe(region.neighbors.length);
    }
  });

  test('the adjacency graph is symmetric (A->B implies B->A)', () => {
    for (const region of board.regions) {
      for (const n of region.neighbors) {
        expect(R.get(n)!.neighbors, `${n} should list ${region.id}`).toContain(region.id);
      }
    }
  });

  test('the adjacency graph is one connected component', () => {
    expect(reachable(board.regions[0]!.id).size).toBe(board.regions.length);
  });

  test('every region has between 2 and 6 neighbours', () => {
    for (const region of board.regions) {
      expect(region.neighbors.length).toBeGreaterThanOrEqual(2);
      expect(region.neighbors.length).toBeLessThanOrEqual(6);
    }
  });

  test('exactly three fortress regions exist and are named', () => {
    const forts = board.regions.filter((r) => r.fortress === true);
    expect(forts.length).toBe(3);
    for (const f of forts) expect(f.nameKey).toBe(`region.${f.id}.name`);
  });
});

describe('continents', () => {
  test('there are exactly 5 continents, each worth a positive bonus', () => {
    expect(continents.length).toBe(5);
    for (const c of continents) {
      expect(c.bonus).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.nameKey).toBe(`continent.${c.id}.name`);
    }
  });

  test('every continent holds at least 3 regions', () => {
    for (const c of continents) expect(c.members.length).toBeGreaterThanOrEqual(3);
  });

  test('membership matches region.continent in both directions', () => {
    const byRegion = new Map(continents.map((c) => [c.id, new Set(c.members)]));
    for (const region of board.regions) {
      expect(byRegion.has(region.continent), region.id).toBe(true);
      expect(byRegion.get(region.continent)!.has(region.id)).toBe(true);
    }
    const listed = continents.reduce((sum, c) => sum + c.members.length, 0);
    expect(listed).toBe(board.regions.length);
    for (const c of continents) {
      for (const m of c.members) expect(R.get(m)!.continent).toBe(c.id);
    }
  });

  test('each continent is internally connected through its own regions', () => {
    for (const c of continents) {
      const members = new Set(c.members);
      const reached = reachable(c.members[0]!, (id) => members.has(id));
      expect(reached.size, `continent ${c.id}`).toBe(members.size);
    }
  });

  test('cross-continent links exist so no continent is an island', () => {
    for (const c of continents) {
      const members = new Set(c.members);
      const linksOut = c.members.some((m) => R.get(m)!.neighbors.some((n) => !members.has(n)));
      expect(linksOut, c.id).toBe(true);
    }
  });
});

describe('geometry', () => {
  test('anchors sit inside the chart canvas and no two share a point', () => {
    const seen = new Set<string>();
    for (const region of board.regions) {
      const [x, y] = region.anchor;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(board.canvas.width);
      expect(y).toBeLessThan(board.canvas.height);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(board.regions.length);
  });

  test('anchors are far enough apart for readable Voronoi cells', () => {
    const pts = board.regions.map((r) => r.anchor);
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        minDist = Math.min(minDist, Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]));
      }
    }
    expect(minDist).toBeGreaterThan(120);
  });
});

describe('deck alignment', () => {
  test('the territory deck has exactly one card per region plus two jokers', () => {
    const regionCards = territory.cards.filter((c) => c.regionId !== undefined);
    const jokers = territory.cards.filter((c) => c.wild === true);
    expect(regionCards.length).toBe(board.regions.length);
    expect(jokers.length).toBe(2);
    expect(new Set(regionCards.map((c) => c.regionId)).size).toBe(board.regions.length);
    for (const card of regionCards) expect(R.has(card.regionId!)).toBe(true);
  });
});
