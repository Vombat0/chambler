/**
 * i18n tests: tr and en must carry identical key sets covering every region,
 * continent, legion, card and rule string used by the pack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');
const manifest = read<{ localization: Record<string, Record<string, string>> }>('manifest.json');
const board = read<{ regions: { id: string; nameKey: string }[] }>('board/board.json');
const continents = read<{ continents: { id: string; nameKey: string }[] }>('board/continents.json')
  .continents;
const territory = read<{ cards: { id: string; titleKey: string; textKey: string }[] }>(
  'cards/territory.json',
);
const legions = read<{ cards: { id: string; titleKey: string; textKey: string }[] }>(
  'cards/legions.json',
);

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

  test('every region and continent has a name in both languages', () => {
    for (const region of board.regions) {
      expect(tr[region.nameKey] ?? null, region.id).not.toBeNull();
      expect(en[region.nameKey] ?? null, region.id).not.toBeNull();
    }
    for (const continent of continents) {
      expect(tr[continent.nameKey] ?? null, continent.id).not.toBeNull();
      expect(en[continent.nameKey] ?? null, continent.id).not.toBeNull();
    }
  });

  test('every card resolves its title and text keys in both languages', () => {
    for (const card of [...territory.cards, ...legions.cards]) {
      expect(tr[card.titleKey] ?? null, card.id).not.toBeNull();
      expect(tr[card.textKey] ?? null, card.id).not.toBeNull();
      expect(en[card.titleKey] ?? null, card.id).not.toBeNull();
      expect(en[card.textKey] ?? null, card.id).not.toBeNull();
    }
  });

  test('all rule sentences are present in both languages', () => {
    const ruleKeys = [
      'rule.setup',
      'rule.reinforce',
      'rule.bonus',
      'rule.attack',
      'rule.defend',
      'rule.pairing',
      'rule.ties',
      'rule.conquest',
      'rule.trade',
      'rule.legion',
      'rule.elimination',
      'rule.end',
    ];
    for (const key of ruleKeys) {
      expect(tr[key] ?? null, key).not.toBeNull();
      expect(en[key] ?? null, key).not.toBeNull();
    }
  });

  test('turkish rule text is really translated, not copied', () => {
    expect(tr['rule.reinforce']).not.toBe(en['rule.reinforce']);
    expect(tr['rule.pairing']).not.toBe(en['rule.pairing']);
    expect(tr['game.title']).toBe(en['game.title']); // the brand name itself stays
  });

  test('manifest.localization mirrors the i18n files exactly', () => {
    expect(manifest.localization.tr).toEqual(tr);
    expect(manifest.localization.en).toEqual(en);
  });
});
