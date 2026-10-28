import { describe, expect, it } from 'vitest';
import {
  CATEGORY_KEY,
  COPY_COUNT_MAX,
  COPY_COUNT_MIN,
  PALETTE_CATEGORIES,
  PALETTE_ITEMS,
  clampCopyCount,
  cycleIndex,
  itemsInCategory,
  nextCopyCount,
  pawnItem,
} from './paletteItems.js';

describe('palette catalog (D2)', () => {
  it('kategori sırası sabittir ve yedi kategoridir', () => {
    expect(PALETTE_CATEGORIES).toEqual(['dice', 'pawns', 'token', 'tile', 'card', 'deck', 'board']);
  });

  it('her kategori en az bir öğe içerir', () => {
    for (const category of PALETTE_CATEGORIES) {
      expect(itemsInCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('öğe kimlikleri benzersizdir', () => {
    const ids = PALETTE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('zar kategorisinde d4..d20 altı öğe vardır', () => {
    const faces = itemsInCategory('dice').map((item) => item.faces);
    expect(faces).toEqual([4, 6, 8, 10, 12, 20]);
  });

  it('piyon tek öğedir ve kind=pawn', () => {
    const items = itemsInCategory('pawns');
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('pawn');
    expect(pawnItem().category).toBe('pawns');
  });

  it('her öğede ikon yolu ve i18n anahtarı vardır', () => {
    for (const item of PALETTE_ITEMS) {
      expect(item.icon.length).toBeGreaterThan(3);
      expect(item.nameKey.startsWith('palette.item.')).toBe(true);
    }
  });

  it('her kategori için i18n anahtarı tanımlıdır', () => {
    for (const category of PALETTE_CATEGORIES) {
      expect(CATEGORY_KEY[category]).toBe(`palette.cat.${category}`);
    }
  });

  it('adet 1–10 aralığına kırpılır ve yuvarlanır', () => {
    expect(clampCopyCount(0)).toBe(COPY_COUNT_MIN);
    expect(clampCopyCount(99)).toBe(COPY_COUNT_MAX);
    expect(clampCopyCount(3.6)).toBe(4);
    expect(clampCopyCount(Number.NaN)).toBe(COPY_COUNT_MIN);
  });

  it('nextCopyCount sınırlarda taşmaz', () => {
    expect(nextCopyCount(1, -1)).toBe(1);
    expect(nextCopyCount(10, 1)).toBe(10);
    expect(nextCopyCount(5, 2)).toBe(7);
  });

  it('cycleIndex negatif ve sıfır uzunlukta güvenlidir', () => {
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(5, 0, 1)).toBe(0);
  });
});
