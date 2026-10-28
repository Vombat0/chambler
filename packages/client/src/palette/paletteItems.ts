/**
 * D2 — Palet kataloğu (saf).
 *
 * Öğeler `ObjectKind` tabanlıdır; her kategori bir `kind` ile eşleşir.
 * İkonlar indirmeden oluşur: `icon` alanı 24×24 SVG `path` verisi.
 * Adet seçici 1–10 aralığındadır (`clampCopyCount`).
 */

import type { ObjectKind } from '@chambler/shared';

export type PaletteCategory = 'dice' | 'pawns' | 'token' | 'tile' | 'card' | 'deck' | 'board';

export interface PaletteItemDef {
  id: string;
  category: PaletteCategory;
  kind: ObjectKind;
  /** i18n anahtarı (`palette.item.d6` gibi). */
  nameKey: string;
  /** 24×24 SVG path verisi (tek gövde). */
  icon: string;
  /** Pawn rengi gibi varsayılan meta. */
  meta?: Record<string, unknown>;
  /** d4–d20 gibi adet dışı bir bilgi alanı. */
  faces?: number;
}

export const COPY_COUNT_MIN = 1;
export const COPY_COUNT_MAX = 10;

export function clampCopyCount(value: number): number {
  if (!Number.isFinite(value)) return COPY_COUNT_MIN;
  return Math.min(COPY_COUNT_MAX, Math.max(COPY_COUNT_MIN, Math.round(value)));
}

export function nextCopyCount(value: number, delta: number): number {
  return clampCopyCount(value + delta);
}

const PATH = (d: string) => d;

export const PALETTE_ITEMS: readonly PaletteItemDef[] = [
  { id: 'd4', category: 'dice', kind: 'die', nameKey: 'palette.item.d4', icon: PATH('M12 3 21 20H3Z'), faces: 4 },
  { id: 'd6', category: 'dice', kind: 'die', nameKey: 'palette.item.d6', icon: PATH('M4 6h16v12H4zM8 9v6M12 9v6M16 9v6'), faces: 6 },
  { id: 'd8', category: 'dice', kind: 'die', nameKey: 'palette.item.d8', icon: PATH('M12 2 22 12 12 22 2 12Z M12 2v20'), faces: 8 },
  { id: 'd10', category: 'dice', kind: 'die', nameKey: 'palette.item.d10', icon: PATH('M12 2 21 10 12 22 3 10Z M12 2v20 M3 10h18'), faces: 10 },
  { id: 'd12', category: 'dice', kind: 'die', nameKey: 'palette.item.d12', icon: PATH('M12 3 20 8 18 19 6 19 4 8Z M20 8l-4 4m0 0-4-4 M12 19v-9'), faces: 12 },
  { id: 'd20', category: 'dice', kind: 'die', nameKey: 'palette.item.d20', icon: PATH('M12 2 21 8 19 20 5 20 3 8Z M21 8 12 13 3 8 M12 20v-7'), faces: 20 },

  { id: 'token', category: 'token', kind: 'token', nameKey: 'palette.item.token', icon: PATH('M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z') },

  { id: 'tile-square', category: 'tile', kind: 'tile', nameKey: 'palette.item.tileSquare', icon: PATH('M4 4h16v16H4zM12 4v16M4 12h16') },
  { id: 'tile-hex', category: 'tile', kind: 'tile', nameKey: 'palette.item.tileHex', icon: PATH('M12 3 20 7v10l-8 4-8-4V7Z') },

  { id: 'card', category: 'card', kind: 'card', nameKey: 'palette.item.card', icon: PATH('M6 3h12v18H6zM9 8h6M9 12h6M9 16h4') },
  { id: 'deck', category: 'deck', kind: 'deck', nameKey: 'palette.item.deck', icon: PATH('M7 5h10v6H7zM6 11h12v6H6zM5 17h14v4H5z') },

  { id: 'board', category: 'board', kind: 'board', nameKey: 'palette.item.board', icon: PATH('M3 4h18v13H3zM3 11h18M9 4v13M3 17v3m18-3v3M12 17v3') },
];

/** Koyu dönüştürülmüş pawn öğesi; renk externally gelir (oyuncu paleti 8 renk). */
export function pawnItem(): PaletteItemDef {
  return { id: 'pawn', category: 'pawns', kind: 'pawn', nameKey: 'palette.item.pawn', icon: PATH('M12 3a3.4 3.4 0 0 0-1.8 6.3C8 10.6 7 12.6 7 15h10c0-2.4-1-4.4-3.2-5.7A3.4 3.4 0 0 0 12 3ZM7 17h10v3H7z') };
}

/** Sabit kategori sırası (UI ve test ile isabetli). */
export const PALETTE_CATEGORIES: readonly PaletteCategory[] = ['dice', 'pawns', 'token', 'tile', 'card', 'deck', 'board'];

export const CATEGORY_KEY: Record<PaletteCategory, string> = {
  dice: 'palette.cat.dice',
  pawns: 'palette.cat.pawns',
  token: 'palette.cat.token',
  tile: 'palette.cat.tile',
  card: 'palette.cat.card',
  deck: 'palette.cat.deck',
  board: 'palette.cat.board',
};

/** Kategoriye göre tüm öğeler (pawn rengi dışarıdan seçilir, tek öğe). */
export function itemsInCategory(category: PaletteCategory): readonly PaletteItemDef[] {
  if (category === 'pawns') return [pawnItem()];
  return PALETTE_ITEMS.filter((item) => item.category === category);
}

/** Klavye gezinme: indeksi adım kadar kaydırır, liste sınırında döngü yapar. */
export function cycleIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  const start = ((index % length) + length) % length;
  return (((start + delta) % length) + length) % length;
}
