/**
 * D2 — Palet klavye gezinmesi (saf, DOM'suz).
 *
 * Panel `role="dialog"` içinde: Esc kapatır, sekmelerde ←/→ kategori
 * değiştirir, öğe ızgarasında oklar odak indeksini taşır, Home/End uçlara
 * gider, Enter/Boşluk ekler. Bu fonksiyonlar React bileşeninden bağımsız
 * test edilir; bileşen yalnızca indeksleri odakla eşler.
 */

import { cycleIndex } from './paletteItems.js';

export type PaletteKeyAction =
  | 'close'
  | 'previousCategory'
  | 'nextCategory'
  | 'previousItem'
  | 'nextItem'
  | 'firstItem'
  | 'lastItem'
  | 'add'
  | 'none';

/** Tek tuş → eylem (odak bağlamı: sekme mi, öğe ızgarası mı). */
export function paletteKeyAction(key: string, context: 'tabs' | 'items' | 'panel'): PaletteKeyAction {
  if (key === 'Escape') return 'close';
  if (key === 'Enter' || key === ' ') {
    return context === 'items' ? 'add' : 'none';
  }
  if (key === 'ArrowLeft') return context === 'tabs' ? 'previousCategory' : 'previousItem';
  if (key === 'ArrowRight') return context === 'tabs' ? 'nextCategory' : 'nextItem';
  if (context !== 'items') return 'none';
  if (key === 'ArrowUp') return 'previousItem';
  if (key === 'ArrowDown') return 'nextItem';
  if (key === 'Home') return 'firstItem';
  if (key === 'End') return 'lastItem';
  return 'none';
}

/**
 * Izgara gezinmesi: sağ/sol ±1, yukarı/aşağı ∓`columns`; satır sonunda
 * döngü (wrap) vardır. `columns` en az 1'dir.
 */
export function moveGridIndex(
  index: number,
  length: number,
  direction: 'up' | 'down' | 'left' | 'right',
  columns: number,
): number {
  if (length <= 0) return 0;
  const cols = Math.max(1, Math.floor(columns));
  const delta =
    direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -cols : cols;
  return cycleIndex(index, length, delta);
}

/** Kategori listesinde bir sonraki/önceki (döngüsel). */
export function cycleCategory<T>(categories: readonly T[], current: T, delta: number): T {
  const index = categories.indexOf(current);
  if (index < 0) return categories[0] as T;
  return categories[cycleIndex(index, categories.length, delta)] as T;
}
