import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

const tr = read<Record<string, string>>('i18n/tr.json');
const en = read<Record<string, string>>('i18n/en.json');
const manifest = read<{ localization: Record<string, Record<string, string>> }>('manifest.json');
const board = read<{ cells: { index: number; nameKey: string }[] }>('board/board.json');
const groups = read<{ groups: { id: string; nameKey: string }[] }>('board/groups.json').groups;
const tokens = read<{ tokens: { id: string; nameKey: string }[] }>('tokens/tokens.json').tokens;
const chance = read<{ cards: { id: string; titleKey: string; textKey: string }[] }>(
  'cards/chance.json',
);
const community = read<{ cards: { id: string; titleKey: string; textKey: string }[] }>(
  'cards/community.json',
);

const KEY_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

describe('localization', () => {
  test('tr and en have exactly the same key set', () => {
    const trKeys = Object.keys(tr).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(trKeys);
    expect(trKeys.length).toBeGreaterThan(140);
  });

  test('every key is well formed and every value is a non-empty string', () => {
    for (const dict of [tr, en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(key).toMatch(KEY_RE);
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('every board cell is named in both languages', () => {
    for (const cell of board.cells) {
      expect(tr[cell.nameKey]).toBeTruthy();
      expect(en[cell.nameKey]).toBeTruthy();
      expect(tr[cell.nameKey]).not.toBe(en[cell.nameKey]);
    }
  });

  test('every colour group, tile type and token is named', () => {
    for (const group of groups) {
      expect(tr[group.nameKey]).toBeTruthy();
      expect(en[group.nameKey]).toBeTruthy();
    }
    for (const token of tokens) {
      expect(tr[token.nameKey]).toBeTruthy();
      expect(en[token.nameKey]).toBeTruthy();
    }
    for (const type of [
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
    ]) {
      expect(tr[`type.${type}`]).toBeTruthy();
      expect(en[`type.${type}`]).toBeTruthy();
    }
  });

  test('all 32 cards have a title and a text in both languages', () => {
    for (const deck of [chance, community]) {
      for (const card of deck.cards) {
        for (const dict of [tr, en]) {
          expect(dict[card.titleKey]).toBeTruthy();
          expect(dict[card.textKey]).toBeTruthy();
        }
      }
    }
  });

  test('rule explanations exist for the core rule set', () => {
    const ruleKeys = [
      'rule.start-money',
      'rule.salary',
      'rule.jail',
      'rule.house',
      'rule.mortgage',
      'rule.auction',
      'rule.bankruptcy',
      'rule.end',
      'rule.even-build',
      'rule.tax',
    ];
    for (const key of ruleKeys) {
      expect(tr[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });

  test('manifest.localization mirrors i18n/*.json byte for byte', () => {
    expect(manifest.localization.tr).toEqual(tr);
    expect(manifest.localization.en).toEqual(en);
  });
});
