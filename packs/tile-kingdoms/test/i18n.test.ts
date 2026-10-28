/**
 * i18n tests: tr and en must carry identical key sets covering every tile,
 * worker, colour, token and rule string used by the pack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');
const manifest = read<{ localization: Record<string, Record<string, string>> }>('manifest.json');
const tiles = read<{ types: { id: string }[] }>('tiles/tiles.json').types;
const workers = read<{ roles: { id: string }[]; colors: { id: string }[] }>('tokens/workers.json');

const KEY_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

describe('localization', () => {
  test('tr and en have exactly the same key set', () => {
    const trKeys = Object.keys(tr).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(trKeys);
    expect(trKeys.length).toBeGreaterThanOrEqual(90);
  });

  test('every key is well formed and every value is a non-empty bounded string', () => {
    for (const dict of [tr, en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(key).toMatch(KEY_RE);
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value.length).toBeLessThanOrEqual(128);
      }
    }
  });

  test('every tile type has a name and a description in both languages', () => {
    for (const t of tiles) {
      for (const dict of [tr, en]) {
        expect(dict[`tile.${t.id}.name`] ?? null, t.id).not.toBeNull();
        expect(dict[`tile.${t.id}.desc`] ?? null, t.id).not.toBeNull();
      }
    }
  });

  test('workers, colours and scoring terms are complete in both languages', () => {
    const keys: string[] = [];
    for (const role of workers.roles) keys.push(`worker.${role.id}.name`, `worker.${role.id}.use`);
    for (const color of workers.colors) keys.push(`color.${color.id}.name`, `token.worker-${color.id}.name`);
    for (const term of ['road', 'city', 'pennant', 'fortress', 'shrine', 'field', 'final']) keys.push(`score.${term}`);
    for (const key of keys) {
      expect(tr[key] ?? null, key).not.toBeNull();
      expect(en[key] ?? null, key).not.toBeNull();
    }
  });

  test('all rule sentences are present in both languages', () => {
    const ruleKeys = [
      'rule.turn',
      'rule.draw',
      'rule.place',
      'rule.edge-match',
      'rule.fallback',
      'rule.worker',
      'rule.majority',
      'rule.road-score',
      'rule.city-score',
      'rule.shrine-score',
      'rule.field-score',
      'rule.end',
      'rule.first-tile',
    ];
    for (const key of ruleKeys) {
      expect(tr[key] ?? null, key).not.toBeNull();
      expect(en[key] ?? null, key).not.toBeNull();
    }
  });

  test('turkish text is really translated, not copied', () => {
    expect(tr['rule.edge-match']).not.toBe(en['rule.edge-match']);
    expect(tr['rule.worker']).not.toBe(en['rule.worker']);
    expect(tr['tile.city-fortress.name']).toBe('Başkale');
    expect(en['tile.city-fortress.name']).toBe('Great Keep');
    expect(tr['worker.scout.name']).toBe('Gözcü');
    expect(tr['game.title']).toBe(en['game.title']); // the brand name itself stays
  });

  test('manifest.localization mirrors the i18n files exactly', () => {
    expect(manifest.localization.tr).toEqual(tr);
    expect(manifest.localization.en).toEqual(en);
  });
});
