/**
 * Brand-protection tests: the pack must stay clear of the original tile game's
 * trademarked names and of any copied terminology, in EVERY text file it ships
 * (JSON, TS, SVG) plus its documentation page. Mechanics may be shared with the
 * genre; names, logos, illustrations and text may not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PACK, '..', '..');

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: 'game title', re: /carcassonne/i },
  { name: 'follower brand word', re: /\bmeeple/i },
  { name: 'designer name', re: /wrede/i },
  { name: 'original publisher', re: /hans\s*im\s*gl/i },
  { name: 'US publisher', re: /z[- ]?man/i },
  { name: 'publisher brand', re: /reefire/i },
];

/** Tile names straight out of the original game's English list — none may appear. */
const COPIED_TILE_NAMES = [
  'the farm',
  'cloister',
  'monastery',
  'cathedral',
  'abbey',
  'the princess',
  'dragon lake',
  'the plague',
  'porcupits',
  'counting the sheep',
];

const TEXT_EXT = ['.json', '.ts', '.md', '.svg'];
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(abs);
    return [abs];
  });

const textFiles = walk(PACK)
  .map((abs) => relative(PACK, abs).split('\\').join('/'))
  .filter((rel) => TEXT_EXT.some((ext) => rel.endsWith(ext)))
  // this file itself must embed the forbidden patterns to detect them
  .filter((rel) => rel !== 'test/trademark.test.ts');

describe('brand protection', () => {
  test('the pack ships a healthy spread of text files to scan', () => {
    expect(textFiles.length).toBeGreaterThanOrEqual(15);
    expect(textFiles).toContain('manifest.json');
    expect(textFiles.some((f) => f.endsWith('.svg'))).toBe(true);
  });

  test('no trademarked names appear in any shipped text file', () => {
    const hits: string[] = [];
    for (const rel of textFiles) {
      const body = readFileSync(join(PACK, rel), 'utf8');
      for (const { name, re } of FORBIDDEN) {
        if (re.test(body)) hits.push(`${rel}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('no tile name is copied from the original game', () => {
    const tiles = JSON.parse(readFileSync(join(PACK, 'tiles/tiles.json'), 'utf8')) as {
      types: { id: string }[];
    };
    for (const dictFile of ['i18n/tr.json', 'i18n/en.json']) {
      const dict = JSON.parse(readFileSync(join(PACK, dictFile), 'utf8')) as Record<string, string>;
      for (const t of tiles.types) {
        for (const key of [`tile.${t.id}.name`, `tile.${t.id}.desc`]) {
          const value = (dict[key] ?? '').toLowerCase();
          for (const copied of COPIED_TILE_NAMES) {
            expect(value.includes(copied), `${dictFile} ${key}`).toBe(false);
          }
        }
      }
    }
  });

  test('the original theme is stated and the docs page stays short', () => {
    const rules = JSON.parse(readFileSync(join(PACK, 'rules/rules.json'), 'utf8')) as {
      attribution: { originalTheme: string };
    };
    expect(rules.attribution.originalTheme).toContain('original');
    const docs = join(REPO, 'docs', 'PACK_TILE_KINGDOMS.md');
    expect(existsSync(docs)).toBe(true);
    const lines = readFileSync(docs, 'utf8').split('\n');
    expect(lines.length).toBeLessThanOrEqual(50);
    const body = readFileSync(docs, 'utf8');
    for (const { name, re } of FORBIDDEN) expect(re.test(body), name).toBe(false);
  });
});
